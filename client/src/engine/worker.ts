// One engine job: a tool (api/_lib), run against WebAssembly ffmpeg and
// gifski (exec.ts).
import { InputError } from "@api/errors";
import { FFmpeg } from "@api/ffmpeg";
import { resultFile, type ToolId } from "@api/formats";
import { TOOLS } from "@api/tools/index";
import { markLook, renderWatermarkFrame } from "@api/tools/mark";
import { exec, HEAP, ROOT as workDir } from "./exec";
import fs from "./fs";
import path from "./path";

// A tool run on the picked files, in the order the tool takes them, or a
// Mark preview.
export type EngineRequest =
  | { tool: ToolId; files: File[]; options: Record<string, unknown> }
  | { preview: Record<string, unknown> & { frame: Blob; logo: Blob } };

type EngineJob = EngineRequest & { modules: Record<string, WebAssembly.Module> };

export type EngineResult = { file: File } | { error: string };

async function run(job: EngineJob): Promise<File> {
  await fs.mkdir(workDir);
  const ff = new FFmpeg("ffmpeg", "gifski", exec(job.modules), HEAP);
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

  const { tool, files, options } = job;
  const { outputPath, suffix, ext } = await TOOLS[tool]({
    ff,
    workDir,
    inputs: files.map((file) => ({ name: file.name, save: (destPath) => write(destPath, file) })),
    options,
  });
  const { name, mime } = resultFile(files[0].name, suffix, ext);
  return new File([await fs.readFile(outputPath)], name, { type: mime });
}

self.onmessage = async ({ data }: MessageEvent<EngineJob>) => {
  try {
    postMessage({ file: await run(data) } satisfies EngineResult);
  } catch (err) {
    console.error(err);
    postMessage({
      error: err instanceof InputError ? err.message : "Processing failed",
    } satisfies EngineResult);
  }
};
