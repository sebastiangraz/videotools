// One engine job: a tool (core/), run against WebAssembly ffmpeg and
// gifski (exec.ts).
import { InputError } from "@videotools/core/errors";
import { FFmpeg } from "@videotools/core/ffmpeg";
import { resultFile, type ToolId } from "@videotools/core/formats";
import { TOOLS } from "@videotools/core/tools/index";
import { markLook, renderWatermarkFrames } from "@videotools/core/tools/mark";
import type { MarkPosition } from "@videotools/core/tools/mark-config";
import resvgUrl from "@resvg/resvg-wasm/index_bg.wasm?url";
import { exec, HEAP, ROOT as workDir } from "./exec";
import fs from "./fs";
import path from "./path";

// A tool run on the picked files, in the order the tool takes them, or a
// Mark preview of a source's frames, the mark at its position in each.
export type EngineRequest =
  | { tool: ToolId; files: File[]; options: Record<string, unknown> }
  | {
      preview: Record<string, unknown> & {
        frames: { image: Blob; position: MarkPosition }[];
        logo: Blob;
      };
    };

type EngineJob = EngineRequest & { modules: Record<string, WebAssembly.Module> };

// A tool's one result, or a preview per frame.
export type EngineResult = { files: File[] } | { error: string };

// Posted while the result is encoded: how far (0–1) it has got.
export type EngineProgress = { progress: number };

async function run(job: EngineJob): Promise<File[]> {
  await fs.mkdir(workDir);
  const ff = new FFmpeg("ffmpeg", "gifski", resvgUrl, exec(job.modules, "preview" in job), HEAP);
  ff.onProgress = (progress) => postMessage({ progress } satisfies EngineProgress);
  const write = async (file: string, blob: Blob) =>
    fs.writeFile(file, new Uint8Array(await blob.arrayBuffer()));

  if ("preview" in job) {
    const { frames, logo, ...look } = job.preview;
    // Names are cosmetic; ffmpeg sniffs the content.
    const logoFile = path.join(workDir, "logo.png");
    await write(logoFile, logo);
    const outputs = await renderWatermarkFrames(
      { ff, workDir },
      {
        ...markLook(look),
        logoFile,
        frames: await Promise.all(
          frames.map(async ({ image, position }, n) => {
            const file = path.join(workDir, `frame${n}.jpg`);
            await write(file, image);
            return { file, position };
          }),
        ),
      },
    );
    return Promise.all(
      outputs.map(
        async (output) =>
          new File([await fs.readFile(output)], "preview.jpg", { type: "image/jpeg" }),
      ),
    );
  }

  const { tool, files, options } = job;
  const { outputPath, suffix, ext } = await TOOLS[tool]({
    ff,
    workDir,
    inputs: files.map((file) => ({ name: file.name, save: (destPath) => write(destPath, file) })),
    options,
  });
  const { name, mime } = resultFile(files[0].name, suffix, ext);
  return [new File([await fs.readFile(outputPath)], name, { type: mime })];
}

self.onmessage = async ({ data }: MessageEvent<EngineJob>) => {
  try {
    postMessage({ files: await run(data) } satisfies EngineResult);
  } catch (err) {
    console.error(err);
    postMessage({
      error: err instanceof InputError ? err.message : "Processing failed",
    } satisfies EngineResult);
  }
};
