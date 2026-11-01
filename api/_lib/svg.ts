// SVG logos rasterize here rather than through ffmpeg: not every pinned ffmpeg
// has librsvg (the macOS build doesn't). resvg is WebAssembly, so it renders the
// same on every platform; the import embeds the .wasm in a compiled engine.
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import wasmPath from "@resvg/resvg-wasm/index_bg.wasm" with { type: "file" };

let ready: Promise<void> | undefined;

// A PNG of the SVG at its own aspect, its long side `side` pixels. resvg
// writes straight alpha, which overlay expects.
export async function svgToPng(svg: Uint8Array, side: number): Promise<Uint8Array> {
  ready ??= initWasm(Bun.file(wasmPath).arrayBuffer());
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
