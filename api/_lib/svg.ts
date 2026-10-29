// SVG logos rasterize here rather than through ffmpeg: the WebAssembly ffmpeg
// has no librsvg. resvg is WebAssembly itself, so it renders the same in the
// browser engine and on the server.
import fs from "node:fs/promises";
import { initWasm, Resvg } from "@resvg/resvg-wasm";

// The browser build turns this into an asset URL; on the server it's a file.
const wasm = new URL("../../node_modules/@resvg/resvg-wasm/index_bg.wasm", import.meta.url);

let ready: Promise<void> | undefined;

// A PNG of the SVG at its own aspect, its long side `side` pixels. resvg
// writes straight alpha, which overlay expects.
export async function svgToPng(svg: Uint8Array, side: number): Promise<Uint8Array> {
  ready ??= initWasm(wasm.protocol === "file:" ? fs.readFile(wasm) : fetch(wasm));
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
