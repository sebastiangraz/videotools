// SVG logos rasterize here rather than through ffmpeg: the WebAssembly ffmpeg
// has no librsvg. resvg is WebAssembly itself, so it renders the same in the
// browser engine and in a native run.
import fs from "node:fs/promises";
import { initWasm, Resvg } from "@resvg/resvg-wasm";

let ready: Promise<void> | undefined;

// A PNG of the SVG at its own aspect, its long side `side` pixels. resvg
// writes straight alpha, which overlay expects. `wasm` is resvg's module
// (FFmpeg.resvg): a file: URL natively, else fetched.
export async function svgToPng(wasm: string, svg: Uint8Array, side: number): Promise<Uint8Array> {
  ready ??= initWasm(wasm.startsWith("file:") ? fs.readFile(new URL(wasm)) : fetch(wasm));
  await ready;
  const intrinsic = new Resvg(svg);
  const mode = intrinsic.width >= intrinsic.height ? "width" : "height";
  intrinsic.free();
  const resvg = new Resvg(svg, { fitTo: { mode, value: side } });
  try {
    const image = resvg.render();
    const png = image.asPng();
    image.free();
    return png;
  } finally {
    resvg.free();
  }
}
