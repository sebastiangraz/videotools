import { ICON } from "./tools";

export type Vec = [number, number];
// A rounded box: centre, half width and height, corner radius.
export type Box = [x: number, y: number, w: number, h: number, r: number];

// A shape on an icon, in icon units, y down: a box (centre, half size and
// corner radius) turned clockwise by `turn` degrees or, given a `sweep`, an
// arc of radius size[0] and half width size[1] from `turn` round through
// `sweep` degrees.
export type Layer = {
  at: Vec;
  size: Vec;
  radius?: number;
  turn?: number;
  sweep?: number;
  // Depth: 0 is the key's alone, below it is behind it. Deeper layers draw
  // first and fade into the page.
  z: number;
  opacity?: number;
  // What fills it: a clip's frame, mixed into its `next` by `mix`; glass,
  // whitened by `glass` (below 0 darkened and lit as if recessed), with a
  // `label` on it; or the text colour at `ink` opacity.
  clip?: string;
  frame?: number;
  next?: number;
  mix?: number;
  glass?: number;
  label?: string;
  ink?: number;
};

// A tool's header icon (icons/<tool>.ts), drawn live by WebGPU. Its key, the
// video every icon plays, morphs into the next icon's.
export type Icon = {
  // Seconds; t = duration must look like t = 0.
  duration: number;
  // Name → URL of a clip from `bun run icons`.
  clips: Record<string, string>;
  // Text for its glass to carry.
  labels?: string[];
  // Where the key rests, in a CELL square around the header's logo slot.
  key: Box;
  // The layers at t, the key's filling `key` as it is now. `show` runs from
  // 0 to 1 as the icon comes in and back as it goes; `frames` counts each
  // clip's.
  layers: (t: number, show: number, key: Box, frames: Record<string, number>) => Layer[];
};

export const mix = <T extends number[]>(a: T, b: T, f: number) =>
  a.map((v, i) => v + (b[i] - v) * f) as T;

export const ease = (f: number) => f * f * (3 - 2 * f);

// The video's timeline in glass along the key's foot, `played` of it lit.
export const timeline = ([x, y, w, h]: Box, played: number): Layer[] => {
  const [half, high] = [w - 7, 2.4];
  const lit = Math.max(high, half * played);
  return [
    {
      at: [x, y + h - 8.6],
      size: [half, high],
      radius: high,
      z: 1,
      glass: -0.2,
    },
    { at: [x - half + lit, y + h - 8.6], size: [lit, high], radius: high, z: 1.1, glass: 0.4 },
  ];
};

// Icon units across the canvas.
const CELL = 144;
// Seconds an icon takes to come in, or to go.
const TRANSITION = 0.6;
// Texels per icon unit in a label's texture layer.
const TEXELS = 4;
const FONT = `500 ${8 * TEXELS}px Styrene`;
// Floats per packed layer, and the most a frame draws.
const STRIDE = 16;
const MAX = 256;

// The look, sizes in icon units.
const SETTINGS = {
  // Light direction in degrees clockwise from the top.
  lightAngle: -45,
  // Fade into the page per unit of depth.
  fog: 0.1,
  // Drop shadow opacity under panes and glass, its blur and downward offset.
  paneShadow: 0.25,
  glassShadow: 0.06,
  shadowBlur: 4.5,
  shadowOffset: 2.5,

  // Glass bevel width and the backdrop shift at its edge, fractions of half
  // the shape's narrow side.
  bevel: 0.4,
  refract: 1.5,
  // Frost blur radius on the flat, and its saturation with no change at 1.
  frost: 9,
  saturation: 1.2,
  // Light within the glass as stacked glows, each fading in from the edges
  // over its bevel (fraction of the shape's narrow side) at its opacity, moved
  // `glowShift` bevels towards the light. `laid` ones go over in white, the
  // rest add light `glowTint` of the way from white to the glass's colour.
  glows: [
    { bevel: 0.02, opacity: 0.04 },
    { bevel: 0.025, opacity: 0.2 },
    { bevel: 0.12, opacity: 0.06, laid: true },
    { bevel: 0.225, opacity: 0.32 },
  ],
  glowShift: 1,
  glowTint: 1,
  // Rim width (a device pixel at least), lit rim opacity, and the glint's on
  // the far side from the light.
  rimWidth: 1,
  rimOpacity: 0.88,
  glint: 0.77,
  // Degrees either side of side-on to the light where neither shows, and the
  // degrees each eases in over.
  rimGap: 36,
  rimFalloff: 40,
  // Rim colour from white at 0 to what it sits on at 1, that frosted over
  // rimFrost and saturated by rimSaturation.
  rimTinge: 0.5,
  rimFrost: 0.5,
  rimSaturation: 2.4,
  // Label text opacity.
  label: 0.25,
};

const SHADER = /* wgsl */ `
struct Uniforms {
  fg: vec4f, // the text colour, premultiplied
  bg: vec4f, // the page's, under the canvas
  px: f32, // icon units per device pixel
}

// A Layer as playIcons packs it.
struct Layer {
  at: vec2f,
  size: vec2f,
  radius: f32,
  turn: f32,
  sweep: f32,
  arc: f32,
  opacity: f32,
  kind: f32,
  amount: f32, // the glass's tint, the ink's opacity
  image: f32, // the texture layer of its frame or label, else -1
  next: f32,
  mix: f32,
  z: f32,
}
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage> layers: array<Layer>;
@group(0) @binding(2) var bilinear: sampler;
// The canvas as the layers below a glass one left it.
@group(0) @binding(3) var backdrop: texture_2d<f32>;
// The icon's clip frames, then its labels.
@group(1) @binding(0) var images: texture_2d_array<f32>;

const CELL = ${CELL};
const CLIP = vec2f(${ICON.clip.join(", ")});
const TEXELS = ${TEXELS};
const PANE = 0.0;
const GLASS = 1.0;
const LUMA = vec3f(0.299, 0.587, 0.114);
const LIGHT = vec2f(sin(radians(${SETTINGS.lightAngle})), -cos(radians(${SETTINGS.lightAngle}))); // towards it

struct Out {
  @builtin(position) at: vec4f,
  @location(0) @interpolate(flat) n: u32,
}

// A triangle over the whole canvas, once per layer.
@vertex fn vs(@builtin(vertex_index) i: u32, @builtin(instance_index) n: u32) -> Out {
  return Out(vec4f(f32(i % 2) * 4 - 1, f32(i / 2) * 4 - 1, 0, 1), n);
}

@fragment fn fs(in: Out) -> @location(0) vec4f {
  let l = layers[in.n];
  let p = in.at.xy * u.px;
  let d = shape(l, p);
  // Past its shadow.
  if (d > ${SETTINGS.shadowBlur + SETTINGS.shadowOffset}) {
    return vec4f();
  }
  var c = u.fg * l.amount;
  var shade = 0.0;
  if (l.kind == PANE) {
    let uv = turn(p - l.at, -l.turn) / l.size / 2 + 0.5;
    c = mix(image(l.image, uv), image(l.next, uv), l.mix);
    shade = ${SETTINGS.paneShadow};
  } else if (l.kind == GLASS) {
    c = vec4f(glass(l, p, d), 1);
    shade = ${SETTINGS.glassShadow};
  }
  c = mix(c, u.bg * c.a, clamp(-l.z * ${SETTINGS.fog}, 0, 1));
  let blur = ${SETTINGS.shadowBlur};
  let shadow = shade * (1 - smoothstep(-blur, blur, shape(l, p - vec2f(0, ${SETTINGS.shadowOffset}))));
  return over(vec4f(0, 0, 0, shadow), c * fill(d)) * l.opacity;
}

// Glass over the backdrop.
fn glass(l: Layer, p: vec2f, d: f32) -> vec3f {
  let e = vec2f(0.1, 0);
  let n = normalize(vec2f(shape(l, p + e) - shape(l, p - e), shape(l, p + e.yx) - shape(l, p - e.yx)));
  // Half the shape's narrow side.
  let half = select(min(l.size.x, l.size.y), l.size.y, l.arc != 0);
  // From the edge in, the bevel refracts sharp and the flat frosts.
  let x = clamp(-d / (${SETTINGS.bevel} * half), 0, 1);
  var c = frost(p - n * ${SETTINGS.refract} * half * (1 - x) * (1 - x), ${SETTINGS.frost} * x);
  c = mix(vec3f(dot(c, LUMA)), c, ${SETTINGS.saturation});
  c = mix(c, vec3f(f32(l.amount > 0)), abs(l.amount));
  // Light within, hugging the edges away from the light: each glow's bevel,
  // opacity, and 1 if laid.
  var glows = array(${SETTINGS.glows.map((glow) => `vec3f(${glow.bevel}, ${glow.opacity}, ${Number(!!glow.laid)})`).join(", ")});
  var added = 0.0;
  var laid = 0.0;
  for (var i = 0; i < ${SETTINGS.glows.length}; i++) {
    let b = glows[i].x * 2 * half;
    let glow = glows[i].y * smoothstep(-b, b, shape(l, p - LIGHT * b * ${SETTINGS.glowShift}));
    if (glows[i].z == 0) {
      added = 1 - (1 - added) * (1 - glow);
    } else {
      laid = 1 - (1 - laid) * (1 - glow);
    }
  }
  c = mix(c + mix(vec3f(1), c, ${SETTINGS.glowTint}) * added, vec3f(1), laid);
  // The rim facing the light, the glint opposite; recessed, darkened glass
  // the other way round.
  let side = sign(l.amount + 1e-6) * degrees(asin(clamp(dot(n, LIGHT), -1, 1)));
  let level = ${SETTINGS.rimOpacity} * ramp(side) + ${SETTINGS.glint} * ramp(-side);
  let paint = frost(p, ${SETTINGS.rimFrost});
  let tinge = clamp(mix(vec3f(dot(paint, LUMA)), paint, ${SETTINGS.rimSaturation}), vec3f(), vec3f(1));
  let rim = 1 - fill(d + max(${SETTINGS.rimWidth}, u.px));
  c = mix(c, mix(vec3f(1), tinge, ${SETTINGS.rimTinge}), level * rim);
  if (l.image >= 0) {
    let text = image(l.image, (p - l.at) * TEXELS / CLIP + 0.5).a;
    c = over(vec4f(c, 1), u.fg * ${SETTINGS.label} * text).rgb;
  }
  return c;
}

// Off side-on to the light, in degrees, to the rim's (or glint's) opacity.
fn ramp(off: f32) -> f32 {
  return smoothstep(0, 1, (off - ${SETTINGS.rimGap}) / ${SETTINGS.rimFalloff});
}

// The backdrop over the page around p, blurred over a disc of radius r, its
// taps spun per pixel so they grain rather than band.
fn frost(p: vec2f, r: f32) -> vec3f {
  let spin = 6.283 * fract(52.983 * fract(dot(p / u.px, vec2f(0.06711, 0.00584))));
  var c = vec4f();
  for (var i = 0.5; i < 32; i += 1) {
    let a = spin + i * 2.39996; // the golden angle
    c += textureSampleLevel(backdrop, bilinear, (p + r * sqrt(i / 32) * vec2f(cos(a), sin(a))) / CELL, 0);
  }
  return (c.rgb + u.bg.rgb * (32 - c.a)) / 32;
}

// Distance from p to the layer's shape, negative inside.
fn shape(l: Layer, p: vec2f) -> f32 {
  let q = turn(p - l.at, -l.turn);
  if (l.arc == 0) {
    return box(q, l.size, l.radius);
  }
  // Mirrored to sweep clockwise.
  let k = vec2f(q.x * select(1.0, -1.0, l.sweep < 0), q.y);
  let top = vec2f(0, -l.size.x);
  if ((degrees(atan2(k.x, -k.y)) + 360) % 360 <= abs(l.sweep)) {
    return abs(length(k) - l.size.x) - l.size.y;
  }
  return min(length(k - top), length(k - turn(top, abs(l.sweep)))) - l.size.y;
}

// Coverage of a shape at distance d.
fn fill(d: f32) -> f32 {
  return clamp(0.5 - d / u.px, 0, 1);
}

// A box of half size h around the origin, its corners rounded by r or as much
// as it allows.
fn box(p: vec2f, h: vec2f, r: f32) -> f32 {
  let c = min(r, min(h.x, h.y));
  let q = abs(p) - h + c;
  return length(max(q, vec2f())) + min(max(q.x, q.y), 0) - c;
}

// p turned clockwise (y is down) by an angle in degrees.
fn turn(p: vec2f, degrees: f32) -> vec2f {
  let a = radians(degrees);
  return vec2f(p.x * cos(a) - p.y * sin(a), p.x * sin(a) + p.y * cos(a));
}

fn over(below: vec4f, top: vec4f) -> vec4f {
  return top + below * (1 - top.a);
}

// Texture layer n at uv in [0, 1]².
fn image(n: f32, uv: vec2f) -> vec4f {
  return textureSampleLevel(images, bilinear, uv, i32(n), 0);
}
`;

type Shown = {
  icon: Icon;
  texture: GPUTexture;
  group: GPUBindGroup;
  // Each clip's (and label's) first texture layer, and each clip's count.
  first: Record<string, number>;
  frames: Record<string, number>;
  show: number;
  start?: number;
};

// Plays the icon last shown on `canvas` until stopped, each new one morphing
// out of the one before; `failed` without WebGPU or AVIF decoding.
export const playIcons = (canvas: HTMLCanvasElement, failed: () => void) => {
  let stopped = false;
  let request = 0;
  let wanted: Icon | undefined;
  // Oldest first: the last coming in (or in), the rest going.
  const shown: Shown[] = [];
  const fail = () => {
    if (!stopped) failed();
  };

  const ready = (async () => {
    const adapter = await navigator.gpu?.requestAdapter();
    // A layer per frame takes more than the default limit.
    const device = await adapter?.requestDevice({
      requiredLimits: { maxTextureArrayLayers: adapter.limits.maxTextureArrayLayers },
    });
    if (!device) throw new Error("No WebGPU");
    const context = canvas.getContext("webgpu")!;
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
      device,
      format,
      alphaMode: "premultiplied",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    const module = device.createShaderModule({ code: SHADER });
    const blend = { srcFactor: "one", dstFactor: "one-minus-src-alpha" } as const;
    const pipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: { module },
      fragment: { module, targets: [{ format, blend: { color: blend, alpha: blend } }] },
    });
    const uniforms = new Float32Array(12);
    const uniformBuffer = device.createBuffer({
      size: uniforms.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const packed = new Float32Array(MAX * STRIDE);
    const layerBuffer = device.createBuffer({
      size: packed.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const sampler = device.createSampler({ magFilter: "linear", minFilter: "linear" });
    let backdrop: GPUTexture | undefined;
    let group: GPUBindGroup | undefined;

    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let last: number | undefined;
    let drawn = "";
    const draw = (now: number) => {
      request = requestAnimationFrame(draw);
      const step = still ? 1 : (now - (last ?? now)) / 1000 / TRANSITION;
      last = now;
      for (const entry of shown) {
        entry.start ??= now;
        const coming = entry === shown.at(-1);
        entry.show = coming ? Math.min(entry.show + step, 1) : Math.max(entry.show - step, 0);
      }
      // Gone ones were wholly under what came after.
      for (let i = shown.length - 2; i >= 0; i--) {
        if (!shown[i].show) shown.splice(i, 1)[0].texture.destroy();
      }
      const side = Math.round(canvas.clientWidth * devicePixelRatio);
      const { color } = getComputedStyle(canvas);
      const { backgroundColor } = getComputedStyle(document.body);
      const frame = shown.map(({ icon, start = now }) =>
        still
          ? 0
          : Math.floor(((now - start) / 1000) * ICON.fps) % Math.round(icon.duration * ICON.fps),
      );
      const state = `${frame.join()} ${shown.map((entry) => entry.show).join()} ${side} ${color} ${backgroundColor}`;
      if (!shown.length || !side || state === drawn) return;
      drawn = state;

      if (canvas.width !== side || !backdrop || !group) {
        canvas.width = canvas.height = side;
        backdrop?.destroy();
        backdrop = device.createTexture({
          size: [side, side],
          format,
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });
        group = device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: uniformBuffer } },
            { binding: 1, resource: { buffer: layerBuffer } },
            { binding: 2, resource: sampler },
            { binding: 3, resource: backdrop.createView() },
          ],
        });
      }
      // rgb() or rgba(), premultiplied.
      const premultiplied = (css: string) => {
        const [r, g, b, a = 1] = css.match(/[\d.]+/g)!.map(Number);
        return [(r / 255) * a, (g / 255) * a, (b / 255) * a, a];
      };
      uniforms.set([...premultiplied(color), ...premultiplied(backgroundColor), CELL / side]);
      device.queue.writeBuffer(uniformBuffer, 0, uniforms);

      // The keys mix into one, each over the ones before by its share so far.
      const weights = shown.map((entry) => ease(entry.show));
      let total = 0;
      const shares = weights.map((weight) => weight / (total += weight) || 0);
      const key = shown.reduce(
        (key, entry, i) => mix(key, entry.icon.key, shares[i]),
        shown[0].icon.key,
      );
      const draws = shown
        .flatMap((entry, i) =>
          entry.icon
            .layers(frame[i] / ICON.fps, weights[i], key, entry.frames)
            .map((layer) => ({ entry, layer, opacity: layer.z ? weights[i] : shares[i] })),
        )
        .sort((a, b) => a.layer.z - b.layer.z);
      draws.forEach(({ entry: { first }, layer: l, opacity }, n) => {
        const image = (name?: string, frame = 0) => (name ? first[name] + frame : -1);
        packed.set(
          [
            ...l.at,
            ...l.size,
            l.radius ?? 0,
            l.turn ?? 0,
            l.sweep ?? 0,
            Number(l.sweep !== undefined),
            (l.opacity ?? 1) * opacity,
            l.glass !== undefined ? 1 : l.ink !== undefined ? 2 : 0,
            l.glass ?? l.ink ?? 0,
            image(l.clip ?? l.label, l.frame),
            image(l.clip, l.next ?? l.frame),
            l.mix ?? 0,
            l.z,
          ],
          n * STRIDE,
        );
      });
      device.queue.writeBuffer(layerBuffer, 0, packed, 0, draws.length * STRIDE);

      const encoder = device.createCommandEncoder();
      const texture = context.getCurrentTexture();
      const begin = (loadOp: GPULoadOp) => {
        const pass = encoder.beginRenderPass({
          colorAttachments: [{ view: texture.createView(), loadOp, storeOp: "store" }],
        });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, group!);
        return pass;
      };
      let pass = begin("clear");
      draws.forEach(({ entry, layer }, n) => {
        // Glass sees what's under it.
        if (layer.glass !== undefined) {
          pass.end();
          encoder.copyTextureToTexture({ texture }, { texture: backdrop! }, [side, side]);
          pass = begin("load");
        }
        pass.setBindGroup(1, entry.group);
        pass.draw(3, 1, 0, n);
      });
      pass.end();
      device.queue.submit([encoder.finish()]);
    };
    if (!stopped) request = requestAnimationFrame(draw);

    // An icon's clips decoded, a texture layer per frame, then its labels.
    const load = async (icon: Icon): Promise<Shown> => {
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
      const labels = icon.labels ?? [];
      if (labels.length) await document.fonts.load(FONT);
      const count = clips.flat().length;
      const texture = device.createTexture({
        size: [...ICON.clip, count + labels.length],
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
      // Centred on their ink, white for the shader to colour.
      const sheet = new OffscreenCanvas(ICON.clip[0], ICON.clip[1]);
      const pen = sheet.getContext("2d")!;
      pen.font = FONT;
      pen.letterSpacing = "0.05em";
      pen.fillStyle = "white";
      labels.forEach((text, k) => {
        const ink = pen.measureText(text);
        pen.clearRect(0, 0, sheet.width, sheet.height);
        pen.fillText(
          text,
          (sheet.width + ink.actualBoundingBoxLeft - ink.actualBoundingBoxRight) / 2,
          (sheet.height + ink.actualBoundingBoxAscent - ink.actualBoundingBoxDescent) / 2,
        );
        device.queue.copyExternalImageToTexture(
          { source: sheet },
          { texture, origin: [0, 0, count + k] },
          ICON.clip,
        );
      });
      const names = Object.keys(icon.clips);
      return {
        icon,
        texture,
        group: device.createBindGroup({
          layout: pipeline.getBindGroupLayout(1),
          entries: [{ binding: 0, resource: texture.createView({ dimension: "2d-array" }) }],
        }),
        first: Object.fromEntries([
          ...names.map((name, k) => [name, clips.slice(0, k).flat().length]),
          ...labels.map((text, k) => [text, count + k]),
        ]),
        frames: Object.fromEntries(names.map((name, k) => [name, clips[k].length])),
        show: 0,
      };
    };
    return { device, load };
  })();
  ready.catch(fail);

  return {
    show: (icon: Icon) => {
      if (icon === wanted) return;
      wanted = icon;
      ready
        .then(async ({ load }) => {
          const entry = await load(icon);
          if (stopped || icon !== wanted) entry.texture.destroy();
          else shown.push(entry);
        })
        .catch(fail);
    },
    stop: () => {
      stopped = true;
      cancelAnimationFrame(request);
      void ready.then(
        ({ device }) => device.destroy(),
        () => {},
      );
    },
  };
};
