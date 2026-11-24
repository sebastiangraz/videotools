import { ICON } from "./tools";

// A tool's header icon (icons/<tool>.ts), drawn live by a WebGPU shader.
export type Icon = {
  // Seconds; t = duration must look like t = 0.
  duration: number;
  // Name → URL of a clip from `bun run icons`. Each frame is a texture layer,
  // and the shader gets each name as its clip's first.
  clips: Record<string, string>;
  // Up to four numbers per frame for the shader's u.params, for what's easier
  // in TS. `frames` counts each clip's.
  params?: (t: number, frames: Record<string, number>) => number[];
  // WGSL with fn icon(p: vec2f) -> vec4f, the premultiplied colour at p in a
  // CELL square, y down: the subject in its middle 72, the rest for what
  // bleeds out of the header's logo slot.
  shader: string;
};

// Icon units across the canvas.
const CELL = 108;

// Every shader's start. Distances are in icon units, negative inside.
const PRELUDE = /* wgsl */ `
struct Uniforms {
  fg: vec4f, // the text colour, premultiplied
  params: vec4f,
  px: f32, // icon units per device pixel
  t: f32, // seconds
}
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var clips: texture_2d_array<f32>;
@group(0) @binding(2) var bilinear: sampler;

const FPS = ${ICON.fps};
const PI = ${Math.PI};

// A triangle over the whole canvas.
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  return vec4f(f32(i % 2) * 4 - 1, f32(i / 2) * 4 - 1, 0, 1);
}

@fragment fn fs(@builtin(position) at: vec4f) -> @location(0) vec4f {
  return icon(at.xy * u.px);
}

// Coverage of a shape at distance d.
fn fill(d: f32) -> f32 {
  return clamp(0.5 - d / u.px, 0, 1);
}

// Coverage of a line of width w along the inside of a shape's edge.
fn stroke(d: f32, w: f32) -> f32 {
  return fill(abs(d + w / 2) - w / 2);
}

// A box of half size h around the origin, its corners rounded by r or as much
// as it allows.
fn box(p: vec2f, h: vec2f, r: f32) -> f32 {
  let c = min(r, min(h.x, h.y));
  let q = abs(p) - h + c;
  return length(max(q, vec2f())) + min(max(q.x, q.y), 0) - c;
}

fn segment(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let h = clamp(dot(p - a, b - a) / dot(b - a, b - a), 0, 1);
  return length(p - a - (b - a) * h);
}

// p turned clockwise (y is down) by an angle in degrees.
fn turn(p: vec2f, degrees: f32) -> vec2f {
  let a = radians(degrees);
  return vec2f(p.x * cos(a) - p.y * sin(a), p.x * sin(a) + p.y * cos(a));
}

// The text colour at an opacity.
fn ink(opacity: f32) -> vec4f {
  return u.fg * opacity;
}

fn over(below: vec4f, top: vec4f) -> vec4f {
  return top + below * (1 - top.a);
}

// Texture layer n at uv in [0, 1]².
fn layer(n: f32, uv: vec2f) -> vec4f {
  return textureSampleLevel(clips, bilinear, uv, i32(n), 0);
}
`;

// Plays `icon` on `canvas` until the returned function stops it; `failed`
// without WebGPU or AVIF decoding.
export const playIcon = (canvas: HTMLCanvasElement, icon: Icon, failed: () => void) => {
  let stopped = false;
  let request = 0;
  const ready = (async () => {
    const adapter = await navigator.gpu?.requestAdapter();
    // A layer per frame takes more than the default limit.
    const device = await adapter?.requestDevice({
      requiredLimits: { maxTextureArrayLayers: adapter.limits.maxTextureArrayLayers },
    });
    if (!device) throw new Error("No WebGPU");

    const clips = await Promise.all(
      Object.values(icon.clips).map(async (url) => {
        const decoder = new ImageDecoder({ data: (await fetch(url)).body!, type: "image/avif" });
        await Promise.all([decoder.completed, decoder.tracks.ready]);
        const frames: VideoFrame[] = [];
        for (let i = 0; i < decoder.tracks.selectedTrack!.frameCount; i++) {
          frames.push((await decoder.decode({ frameIndex: i })).image);
        }
        decoder.close();
        return frames;
      }),
    );
    const texture = device.createTexture({
      size: [...ICON.clip, clips.flat().length],
      format: "rgba8unorm",
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
    clips.flat().forEach((frame, z) => {
      device.queue.copyExternalImageToTexture(
        { source: frame },
        { texture, origin: [0, 0, z] },
        ICON.clip,
      );
      frame.close();
    });
    const names = Object.keys(icon.clips);
    const frames = Object.fromEntries(names.map((name, k) => [name, clips[k].length]));
    const firsts = names.map((name, k) => `const ${name} = ${clips.slice(0, k).flat().length};\n`);

    const context = canvas.getContext("webgpu")!;
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: "premultiplied" });
    const module = device.createShaderModule({ code: PRELUDE + firsts.join("") + icon.shader });
    const pipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: { module },
      fragment: { module, targets: [{ format }] },
    });
    const uniforms = new Float32Array(12);
    const buffer = device.createBuffer({
      size: uniforms.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer } },
        { binding: 1, resource: texture.createView({ dimension: "2d-array" }) },
        {
          binding: 2,
          resource: device.createSampler({ magFilter: "linear", minFilter: "linear" }),
        },
      ],
    });

    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const count = Math.round(icon.duration * ICON.fps);
    let start: number | undefined;
    let shown = "";
    // Draws when the frame, the canvas's size or the text colour changes.
    const draw = (now: number) => {
      start ??= now;
      const i = still ? 0 : Math.floor(((now - start) / 1000) * ICON.fps) % count;
      const side = Math.round(canvas.clientWidth * devicePixelRatio);
      const { color } = getComputedStyle(canvas);
      if (side && `${i} ${side} ${color}` !== shown) {
        shown = `${i} ${side} ${color}`;
        if (canvas.width !== side) canvas.width = canvas.height = side;
        const t = i / ICON.fps;
        // rgb() or rgba()
        const [r, g, b, a = 1] = color.match(/[\d.]+/g)!.map(Number);
        uniforms.set([(r / 255) * a, (g / 255) * a, (b / 255) * a, a]);
        uniforms.set(icon.params?.(t, frames) ?? [], 4);
        uniforms.set([CELL / side, t], 8);
        device.queue.writeBuffer(buffer, 0, uniforms);
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass({
          colorAttachments: [
            { view: context.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store" },
          ],
        });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.draw(3);
        pass.end();
        device.queue.submit([encoder.finish()]);
      }
      request = requestAnimationFrame(draw);
    };
    if (!stopped) request = requestAnimationFrame(draw);
    return device;
  })();
  ready.catch(() => {
    if (!stopped) failed();
  });
  return () => {
    stopped = true;
    cancelAnimationFrame(request);
    void ready.then(
      (device) => device.destroy(),
      () => {},
    );
  };
};
