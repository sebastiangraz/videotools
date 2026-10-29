// One engine job: the server's own tools (api/_lib), run here against
// WebAssembly ffmpeg and gifski (exec.ts) instead of native binaries.
import { InputError } from "@api/errors";
import { FFmpeg } from "@api/ffmpeg";
import { STILLS, formatById, type FormatId, type ToolId } from "@api/formats";
import { TOOLS } from "@api/tools/index";
import { markLook, renderWatermarkFrame } from "@api/tools/mark";
import { exec, modules } from "./exec";
import fs from "./fs";
import path from "./path";

// What /api/process and /api/preview take, with the uploads as files.
export type EngineRequest =
  | {
      tool: ToolId;
      filename: string;
      body: Record<string, unknown> & { options: Record<string, unknown> };
      uploads: Record<string, File>;
    }
  | { preview: Record<string, unknown> & { frame: Blob; logo: Blob } };

type EngineJob = EngineRequest & { modules: Record<string, WebAssembly.Module> };

export type EngineResult = { file: File } | { error: string; code?: string };

const workDir = "/work";

async function run(job: EngineJob): Promise<File> {
  Object.assign(modules, job.modules);
  await fs.mkdir(workDir);
  const ff = new FFmpeg("ffmpeg", "gifski", exec);
  const write = async (file: string, blob: Blob) =>
    fs.writeFile(file, new Uint8Array(await blob.arrayBuffer()));

  if ("preview" in job) {
    const { frame, logo, ...look } = job.preview;
    // Names are cosmetic; ffmpeg sniffs the content.
    const frameFile = path.join(workDir, "frame.jpg");
    const logoFile = path.join(workDir, "logo.png");
    await write(frameFile, frame);
    await write(logoFile, logo);
    const output = await renderWatermarkFrame(
      { ff, workDir },
      { frameFile, logoFile, ...markLook(look) },
    );
    return new File([await fs.readFile(output)], "preview.jpg", { type: "image/jpeg" });
  }

  const { tool, filename, body, uploads } = job;
  const { inputs, run } = TOOLS[tool];
  const urls = inputs(body);
  if (!Array.isArray(urls)) throw new Error(urls.error);
  const { outputPath, suffix, ext } = await run({
    ff,
    workDir,
    inputs: urls,
    options: body.options,
    download: (url, destPath) => write(destPath, uploads[url]),
  });
  const base = filename.replace(/\.[^.]+$/, "").replace(/[^\w.-]/g, "_");
  const type = (STILLS.find((s) => s.id === ext) ?? formatById(ext as FormatId)).mime;
  return new File([await fs.readFile(outputPath)], `${base}_${suffix}.${ext}`, { type });
}

self.onmessage = async ({ data }: MessageEvent<EngineJob>) => {
  let result: EngineResult;
  try {
    result = { file: await run(data) };
  } catch (err) {
    console.error(err);
    result =
      err instanceof InputError
        ? { error: err.message, code: err.code }
        : { error: "Processing failed" };
  }
  postMessage(result);
};
