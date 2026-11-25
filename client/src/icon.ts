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
  // `label` on it; or what's under it blurred, under the text colour at `ink`
  // opacity (black below 0).
  clip?: keyof typeof CLIPS;
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
  // Text for its glass to carry.
  labels?: string[];
  // How its cloud and sky clips look, over CLOUD's.
  cloud?: Partial<typeof CLOUD>;
  // Where the key rests, in a CELL square around the header's logo slot.
  key: Box;
  // The layers at t, the key's filling `key` as it is now. `show` eases from
  // 0 to 1 as the icon comes in and back as it goes, moving layers but never
  // adding or dropping one.
  layers: (t: number, show: number, key: Box) => Layer[];
};

// The clips a pane can play and their lengths in frames, drawn live by the
// shader's clip() in the canvas's --clip-fg on its --clip-bg.
export const CLIPS = {
  slide: 180,
  grow: 120,
  ball: 1,
  vee: 1,
  triangle: 1,
  cloud: 360,
  sky: 360,
};

export const mix = <T extends number[]>(a: T, b: T, f: number) =>
  a.map((v, i) => v + (b[i] - v) * f) as T;

// The curve from 0 through control points a and b to 1, at s.
const bezier = (a: number, b: number, s: number) =>
  3 * s * (1 - s) * (a * (1 - s) + b * s) + s ** 3;

// EASING at f: the curve's y where its x is f, found by halving.
export const ease = (f: number) => {
  const [x1, y1, x2, y2] = EASING;
  let [lo, hi] = [0, 1];
  while (hi - lo > 1e-6) {
    const s = (lo + hi) / 2;
    if (bezier(x1, x2, s) < f) lo = s;
    else hi = s;
  }
  return bezier(y1, y2, lo);
};

// CSS's round(): v to the nearest multiple of step, halfway up.
const round = (v: number, step: number) => Math.round(v / step) * step;

// The video's timeline in glass along the key's foot, `played` of it lit.
export const timeline = ([x, y, w, h]: Box, played: number): Layer[] => {
  const [half, high] = [w - 7, 3];
  const lit = Math.max(high, half * played);
  return [
    {
      at: [x, y + h - 9],
      size: [half, high],
      radius: high,
      z: 1,
      ink: -0.1,
    },
    { at: [x - half + lit, y + h - 9], size: [lit, high], radius: high, z: 1.1, glass: 0.4 },
  ];
};

// Icon units across the canvas.
const CELL = 144;
// Seconds an icon takes to come in, or to go.
const TRANSITION = 0.6;
// How every icon motion eases, as CSS's cubic-bezier() takes it. Going plays
// it backwards; y past 0 or 1 overshoots where layers rest.
const EASING = [0.85, 0, 0.15, 1];
// Texels per icon unit in a label's texture layer at most; below that one per
// device pixel, so its text is drawn at the size it shows.
const TEXELS = 4;
const font = (texels: number) => `500 ${9 * texels}px Styrene`;
// Floats per packed layer, and the most a frame draws.
const STRIDE = 16;
const MAX = 256;

// The look, sizes in icon units.
const SETTINGS = {
  // Box corners, as CSS's `corner-shape: superellipse()` takes them.
  corner: 1.45,
  // Light direction in degrees clockwise from the top.
  lightAngle: -45,
  // Fade into the page per unit of depth.
  fog: 0.14,
  // Light a pane's edge, a CSS pixel wide, adds (plus-lighter) along its top on
  // a dark page, or takes (plus-darker) along its foot on a light one.
  paneEdge: 0.08,
  // Light a clip's surroundings bounce on to its solid shapes, as if each were
  // a glossy dome mirroring the clip's colour: from a floor below, `floor` at
  // most, focused straight down by `floorFocus`, and from walls around at
  // `walls`. Outlines' slopes round off over `smoothing` of how deep they are
  // where their sides meet.
  floor: 0.5,
  floorFocus: 3,
  walls: 0.2,
  smoothing: 0.28,

  // Glass bevel width and the backdrop shift at its edge, fractions of half
  // the shape's narrow side.
  bevel: 0.4,
  refract: 1.6,
  // Frost blur radius on the flat, and its saturation with no change at 1.
  frost: 12,
  saturation: 1.2,
  // Light within the glass as stacked glows, each fading in from the edges
  // over its bevel (fraction of the shape's narrow side) at its opacity, moved
  // `glowShift` bevels towards the light. `laid` ones go over in white, the
  // rest add light `glowTint` of the way from white to the glass's colour.
  glows: [
    { bevel: 0.025, opacity: 0.2 },
    { bevel: 0.12, opacity: 0.06, laid: true },
    { bevel: 0.225, opacity: 0.32 },
  ],
  glowShift: 1,
  glowTint: 1,
  // Rim width (a device pixel at least), lit rim opacity, and the glint's on
  // the far side from the light.
  rimWidth: 1,
  rimOpacity: 0.96,
  glint: 0.77,
  // Degrees either side of side-on to the light where neither shows, and the
  // degrees each eases in over.
  rimGap: 36,
  rimFalloff: 60,
  // Rim colour from white at 0 to what it sits on at 1, that saturated by
  // rimSaturation.
  rimTinge: 0.5,
  rimSaturation: 2.4,
  // Label text opacity.
  label: 0.25,
  // Ink blurs what's under it as CSS's `backdrop-filter: blur()` does by
  // this.
  inkBlur: 4,
};

// How the cloud and sky clips look where an icon doesn't say, sizes in half
// pane heights as the lone cloud is laid out.
const CLOUD = {
  // Shown this many times the size it's laid out at.
  scale: 1.4,
  // Its big domes, each's centre (y down) and radius; how much their radii
  // swell and shrink over the loop; and how close their heights come before
  // they round into each other.
  domes: [
    [-0.08, -0.1, 0.34],
    [-0.4, 0.08, 0.22],
    [0.32, 0.02, 0.3],
    [0.18, -0.2, 0.2],
    [-0.3, -0.04, 0.2],
    [0.05, 0.12, 0.26],
  ],
  breathe: 0.1,
  domeBlend: 0.1,
  // Its flat base, and the thickness its edge is at: more shrinks it.
  base: 0.8,
  edge: 0.13,
  // Octaves of smaller lobes over the domes, the first's per unit, each half
  // the size of the last; their height for their size; and how close their
  // heights come before they round into each other.
  lobes: 1,
  lobeScale: 1.5,
  lobeHeight: 0.7,
  lobeBlend: 0.1,
  // Each lobe's radius in its cell: at least `lobeRadius`, up to `lobeSpread`
  // more, swelling and shrinking by `lobeSwell` as it drifts round a circle of
  // radius `lobeDrift`. Past 1.5 together, lobes are cut off by their cells'
  // neighbours.
  lobeRadius: 0.1,
  lobeSpread: 0.1,
  lobeSwell: 0.1,
  lobeDrift: 0.02,
  // Shading: its surface's slope, taken over `smoothing` (more is softer) and
  // steepened by `relief`; the light's height for each unit it's off towards
  // LIGHT; where highlights start, from 0 (side-on to the light) to 1 (facing
  // it); and the share of the ink they take.
  smoothing: 0.025,
  relief: 0.27,
  lightHeight: 1.2,
  highlightFrom: 0.9,
  highlight: 0.9,
  // How fast ink builds with thickness: less is more see-through.
  density: 16,
  // Grain in the half tones.
  grain: 0.1,
  // The sky clip: a cloud per square cell, `clusters` cells across the pane
  // and `clusterRows` down, the rows centred on the pane and moved by
  // `clusterX` and `clusterY`, blown right to left `clusterDrift` pane widths
  // per loop (whole, at least 1, so the loop wraps).
  clusters: 2,
  clusterRows: 2,
  clusterX: 0,
  clusterY: 0,
  clusterDrift: 1,
  // The share of cells with a cloud, and how far each strays from its cell's
  // centre, in cells.
  clusterCoverage: 1,
  clusterScatter: 0,
  // The clear space round the largest clouds, a share of their cells: at 0 a
  // cloud fills its cell as the lone one fills its pane, below 0 they overlap.
  clusterSpacing: 0,
  // How much smaller than the largest each cloud can be, at random; how much
  // of that range each sweeps through over the loop, at its own phase (0 keeps
  // sizes still); and how close touching clouds' heights come before they
  // round into each other. A cloud is cut off where it reaches more than two
  // cells across or one up or down from its own.
  clusterSpread: 0,
  clusterSwell: 0,
  clusterBlend: 0.15,
  // Each cloud's width and height for its size, 1 as its domes make it, and
  // how far its width over height strays at random, at most 2 to the power of
  // `clusterStretch` times wider or taller.
  clusterWidth: 1,
  clusterHeight: 1,
  clusterStretch: 0,
  // How much the clouds fade out at the pane's edge, 0 not at all, 1 wholly;
  // how far in from it they fade; and how, as CSS's cubic-bezier() takes it
  // (this one is smoothstep()).
  vignette: 0,
  vignetteWidth: 0.4,
  vignetteCurve: [1 / 3, 0, 2 / 3, 1] as [number, number, number, number],
};
// CLOUD's numbers and fixed lists of them, in the order the shader's Cloud
// holds them.
const FIELDS = Object.keys(CLOUD).filter((key) => key !== "domes") as Exclude<
  keyof typeof CLOUD,
  "domes"
>[];

// The solid clips' outlines as SVG path data, on a 34 unit viewBox laid half
// the pane high over its centre.
const OUTLINES = {
  vee: "M33 20a4 4 0 0 1-4 4h-8.078c-.562 0-.696.785-.166.972l7.586 2.674c.888.313.89 1.568.004 1.885l-9.328 3.331a6 6 0 0 1-4.036 0l-9.328-3.331c-.887-.317-.884-1.572.004-1.885l7.586-2.674c.53-.187.396-.972-.166-.972H5a4 4 0 0 1-4-4V1.533C1 .525 2.323.15 2.852 1.009l12.445 20.223a2 2 0 0 0 3.406 0L31.148 1.01C31.677.15 33 .525 33 1.533z",
  // Sides 40.8 long, corners rounded by 3.4.
  triangle:
    "M28.232 12.242c3.514 2 5.27 3.001 5.804 4.34.39.978.39 2.068 0 3.046-.533 1.339-2.29 2.34-5.804 4.34l-16.646 9.479c-3.451 1.965-5.177 2.948-6.59 2.734a4.11 4.11 0 0 1-2.61-1.518c-.886-1.121-.886-3.107-.886-7.08V8.627c0-3.972 0-5.958.885-7.079A4.11 4.11 0 0 1 4.997.03c1.412-.214 3.138.768 6.59 2.734z",
} satisfies Partial<Record<keyof typeof CLIPS, string>>;
// Texels across a depth map, a square as high as the pane round its centre.
const MAP = 256;

// The squared distances `grid` holds to its nearest zero, carried along one
// of its lines (MAP values `step` apart from `at`) in place: the lower envelope
// of a parabola from each value (Felzenszwalb and Huttenlocher).
const envelope = (grid: Float64Array, at: number, step: number) => {
  const f = new Float64Array(MAP);
  for (let q = 0; q < MAP; q++) f[q] = grid[at + q * step];
  const cross = (q: number, r: number) => (f[q] + q * q - f[r] - r * r) / (q - r) / 2;
  // The envelope's parabolas, and where each takes over.
  const v = new Int32Array(MAP);
  const z = new Float64Array(MAP + 1);
  [z[0], z[1]] = [-Infinity, Infinity];
  for (let q = 1, k = 0; q < MAP; q++) {
    let s = cross(q, v[k]);
    while (s <= z[k]) s = cross(q, v[--k]);
    v[++k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  for (let q = 0, k = 0; q < MAP; q++) {
    while (z[k + 1] < q) k++;
    grid[at + q * step] = f[v[k]] + (q - v[k]) ** 2;
  }
};

// One line of `grid`, as envelope() takes it, averaged over the 2r + 1 values
// round each in place, its ends held.
const box = (grid: Float64Array, at: number, step: number, r: number) => {
  const f = new Float64Array(MAP);
  for (let q = 0; q < MAP; q++) f[q] = grid[at + q * step];
  const held = (q: number) => f[Math.min(Math.max(q, 0), MAP - 1)];
  let sum = 0;
  for (let q = -r; q <= r; q++) sum += held(q);
  for (let q = 0; q < MAP; q++) {
    grid[at + q * step] = sum / (2 * r + 1);
    sum += held(q + r + 1) - held(q - r);
  }
};

// An outline's depth map, from the canvas's raster of it: per texel the
// distance to it in half pane heights (negative inside), and its slope as a
// dome, upright at the edge and level as far in as the outline is deep. The
// slope follows the distance field blurred by `smoothing` of that depth, which
// rounds off its creases where sides meet.
const depthMap = (d: string) => {
  const pen = new OffscreenCanvas(MAP, MAP).getContext("2d")!;
  // 68 viewBox units across, its centre on the map's.
  pen.setTransform(MAP / 68, 0, 0, MAP / 68, MAP / 4, MAP / 4);
  pen.fill(new Path2D(d));
  const { data } = pen.getImageData(0, 0, MAP, MAP);
  const cover = Float64Array.from({ length: MAP * MAP }, (_, i) => data[4 * i + 3] / 255);
  // Texels to the edge from outside it (or in), an antialiased texel's
  // coverage telling how far past its centre the edge runs.
  const distances = (cover: Float64Array) => {
    const grid = cover.map((a) => (a >= 1 ? 0 : a > 0 ? Math.max(0, 0.5 - a) ** 2 : 1e12));
    for (let i = 0; i < MAP; i++) envelope(grid, i, MAP);
    for (let i = 0; i < MAP; i++) envelope(grid, i * MAP, 1);
    return grid.map(Math.sqrt);
  };
  const inside = distances(cover.map((a) => 1 - a));
  const field = distances(cover).map((d, i) => d - inside[i]);
  // Three times its mean depth: its incircle's radius, if it has one.
  const inner = field.filter((d) => d < 0);
  const depth = (-3 * inner.reduce((sum, d) => sum + d)) / inner.length;
  // The field after three box blurs by r, near enough a gaussian.
  const blurred = (r: number) => {
    const out = field.slice();
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < MAP; i++) box(out, i, MAP, r);
      for (let i = 0; i < MAP; i++) box(out, i * MAP, 1, r);
    }
    return out;
  };
  // A texel's blur evens out the steps the raster leaves along its edge.
  const edge = blurred(1);
  const smooth = blurred(Math.round(SETTINGS.smoothing * depth));
  // Its slope from the texels either side, held at the map's edges.
  const at = (x: number, y: number) =>
    smooth[Math.min(Math.max(y, 0), MAP - 1) * MAP + Math.min(Math.max(x, 0), MAP - 1)];
  const map = new Float16Array(4 * MAP * MAP);
  edge.forEach((d, i) => {
    const [x, y] = [i % MAP, Math.floor(i / MAP)];
    const sx = (at(x + 1, y) - at(x - 1, y)) / 2;
    const sy = (at(x, y + 1) - at(x, y - 1)) / 2;
    // Its full steepness for its depth, bar where the blur evens it out.
    const k = Math.min(Math.max(1 + smooth[i] / depth, 0), 1) / Math.max(Math.hypot(sx, sy), 0.5);
    map.set([d / (MAP / 2), sx * k, sy * k], 4 * i);
  });
  return map;
};

const SHADER = /* wgsl */ `
struct Uniforms {
  fg: vec4f, // the text colour, premultiplied
  bg: vec4f, // the page's, under the canvas
  clipBg: vec4f, // what fills a clip
  clipFg: vec4f, // and its shapes
  px: f32, // icon units per device pixel
  cssPx: f32, // and per CSS pixel
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
  image: f32, // the pane's clip, the glass's label (a texture layer), else -1
  frame: f32,
  next: f32,
  mix: f32,
  z: f32,
}

// An icon's CLOUD.
struct Cloud {
  ${FIELDS.map((key) => {
    const value = CLOUD[key];
    return `${key}: ${typeof value === "number" ? "f32" : `array<f32, ${value.length}>`},`;
  }).join("\n  ")}
  domes: array<vec4f>, // centre (y down) and radius
}
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage> layers: array<Layer>;
@group(0) @binding(2) var bilinear: sampler;
// The canvas as the layers below a glass or ink one left it.
@group(0) @binding(3) var backdrop: texture_2d<f32>;
// The outlines' depth maps, in OUTLINES' order.
@group(0) @binding(4) var outlines: texture_2d_array<f32>;
// The icon's labels, and how its clouds look.
@group(1) @binding(0) var images: texture_2d_array<f32>;
@group(1) @binding(1) var<storage> look: Cloud;

const CELL = ${CELL};
const CLIP = vec2f(${ICON.clip.join(", ")});
const TEXELS = ${TEXELS};
const PANE = 0.0;
const GLASS = 1.0;
${Object.keys(CLIPS)
  .map((name, i) => `const ${name.toUpperCase()} = ${i};`)
  .join("\n")}
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
  if (fill(d) == 0) {
    return vec4f();
  }
  var c = select(u.fg, vec4f(0, 0, 0, 1), l.amount < 0) * abs(l.amount);
  if (l.kind == PANE) {
    let h = l.size.y;
    let q = turn(p - l.at, -l.turn) / h;
    let n = i32(l.image);
    var a = clip(n, l.frame, q, h);
    if (l.mix > 0) {
      a = mix(a, clip(n, l.next, q, h), l.mix);
    }
    if (n == CLOUD || n == SKY) {
      a *= 1 - look.vignette * (1 - ease(look.vignetteCurve, saturate(-d / h / look.vignetteWidth)));
    }
    c = mix(u.clipBg, over(u.clipBg, u.clipFg), a);
    // 1 on a dark page, -1 on a light one.
    let s = select(-1.0, 1.0, dot(u.bg.rgb, LUMA) < 0.5);
    let edge = 1 - fill(shape(l, p - vec2f(0, s * u.cssPx)));
    c = vec4f(saturate(c.rgb + s * ${SETTINGS.paneEdge} * edge), c.a);
  } else if (l.kind == GLASS) {
    c = vec4f(glass(l, p, d), 1);
  } else {
    // A disc twice the deviation spreads as far as a CSS blur.
    c = over(vec4f(frost(p, ${2 * SETTINGS.inkBlur}), 1), c);
  }
  c = mix(c, u.bg * c.a, clamp(-l.z * ${SETTINGS.fog}, 0, 1));
  return c * fill(d) * saturate(l.opacity);
}

// Glass over the backdrop.
fn glass(l: Layer, p: vec2f, d: f32) -> vec3f {
  let e = vec2f(0.1, 0);
  let g = vec2f(shape(l, p + e) - shape(l, p - e), shape(l, p + e.yx) - shape(l, p - e.yx));
  // None on a ridge, such as a pill's spine, deep inside where it goes unused.
  let n = g / max(length(g), 1e-6);
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
  let paint = over(u.bg, textureSampleLevel(backdrop, bilinear, p / CELL, 0)).rgb;
  let tinge = clamp(mix(vec3f(dot(paint, LUMA)), paint, ${SETTINGS.rimSaturation}), vec3f(), vec3f(1));
  let rim = 1 - fill(d + max(${SETTINGS.rimWidth}, u.px));
  c = mix(c, mix(vec3f(1), tinge, ${SETTINGS.rimTinge}), level * rim);
  if (l.image >= 0) {
    // Its texels on whole device pixels.
    let k = min(1 / u.px, TEXELS);
    let text = image(l.image, (p * k - round(l.at * k)) / CLIP + 0.5).a;
    c = over(vec4f(c, 1), u.fg * ${SETTINGS.label} * text).rgb;
  }
  return c;
}

// How much of its shapes' colour clip n shows at frame f, at q in units of h,
// half the pane's height, from its centre.
fn clip(n: i32, f: f32, q: vec2f, h: f32) -> f32 {
  switch (n) {
    // A ball crossing from left to right.
    case SLIDE {
      return solid(ball(q - vec2f(mix(-0.85, 0.85, f / ${CLIPS.slide}), 0), 0.4), h);
    }
    // Balls growing out of the middle, fading as they go.
    case GROW {
      var a = 0.0;
      for (var i = 0.0; i < 4; i += 1) {
        let s = fract(f / ${CLIPS.grow} + i / 4);
        a = 1 - (1 - a) * (1 - (1 - s) * fill(h * (length(q) - 1.7 * s)));
      }
      return a;
    }
    case BALL {
      return solid(ball(q, 0.5), h);
    }
    ${Object.keys(OUTLINES)
      .map(
        (name, i) => `case ${name.toUpperCase()} {
      return solid(textureSampleLevel(outlines, bilinear, q / 2 + 0.5, ${i}, 0).xyz, h);
    }`,
      )
      .join("\n    ")}
    case CLOUD {
      return cloud(q / look.scale, f / ${CLIPS.cloud}, u.px / h / look.scale, n);
    }
    // Moved, in the sky's units, look.clusters cells across the pane.
    case SKY {
      let m = look.clusters / look.scale * CLIP.y / CLIP.x;
      let p = q - vec2f(look.clusterX, look.clusterY);
      return cloud(p * m, f / ${CLIPS.sky}, u.px / h * m, n);
    }
    default {
      return 0;
    }
  }
}

// A ball of radius r round q's origin: the distance to it, and its slope as a
// dome.
fn ball(q: vec2f, r: f32) -> vec3f {
  return vec3f(length(q) - r, q / r);
}

// A solid shape's ink, s.x its distance in units of h and s.yz its slope,
// less the light it mirrors from its surroundings.
fn solid(s: vec3f, h: f32) -> f32 {
  let n = normalize(vec3f(s.yz, sqrt(max(1 - dot(s.yz, s.yz), 0))));
  let r = reflect(vec3f(0, 0, -1), n);
  let below = ${SETTINGS.floor} * pow(saturate(r.y), ${SETTINGS.floorFocus});
  let around = ${SETTINGS.walls} * (1 - smoothstep(-0.5, 0.75, r.z)) * saturate(1 - n.y);
  return fill(h * s.x) * (1 - saturate(below + around));
}

// Clip n's cumulus or sky at q as s goes from 0 to 1, its billows lit from
// LIGHT and grained in the half tones; px is a device pixel in q's units.
fn cloud(q: vec2f, s: f32, px: f32, n: i32) -> f32 {
  // Its thickness at q, and a little right and down of it.
  let e: f32 = look.smoothing;
  var t: vec3f;
  for (var i = 0; i < 3; i++) {
    let p = q + e * vec2f(f32(i == 1), f32(i == 2));
    if (n == SKY) {
      t[i] = sky(p, s, px);
    } else {
      t[i] = billows(p, s, px, 0);
    }
  }
  let normal = normalize(vec3f(t.x - t.yz, e / look.relief));
  let lit = smoothstep(look.highlightFrom, 1, dot(normal, normalize(vec3f(LIGHT, look.lightHeight))));
  let ink = (1 - exp(-look.density * max(t.x, 0))) * (1 - look.highlight * lit);
  let grain = hash(vec3f(floor(q / px), 0)).x - 0.5;
  return saturate(ink + look.grain * grain * ink * (1 - ink));
}

// The sky's thickness at q, blown right to left as s goes from 0 to 1: a
// cumulus per cell, cells as wide as the lone one's pane is high, in rows 0
// up to look.clusterRows, each the same as the one ring cells along.
fn sky(q: vec2f, s: f32, px: f32) -> f32 {
  let side = 2 / look.scale;
  let ring: f32 = look.clusters * look.clusterDrift;
  let p = q + side * vec2f(ring * s, look.clusterRows / 2);
  var t = -1.0;
  for (var y = -1.0; y <= 1; y += 1) {
    for (var x = -2.0; x <= 2; x += 1) {
      let cell = floor(p / side) + vec2f(x, y);
      // Whether it has a cloud, its size, and its phase; where it is in its
      // cell, and its look and shape.
      let id = vec3f(cell.x - ring * floor(cell.x / ring), cell.y, 1);
      let h = hash(id);
      let g = hash(id + vec3f(0, 0, 1));
      if (h.x < look.clusterCoverage && cell.y >= 0 && cell.y < look.clusterRows) {
        let grow = mix(h.y, 0.5 + 0.5 * sin(6.283 * (s + h.z)), look.clusterSwell);
        let a = (1 - look.clusterSpacing) * (1 - look.clusterSpread * grow);
        let e = exp2(look.clusterStretch * (g.z - 0.5));
        let size = a * vec2f(look.clusterWidth * e, look.clusterHeight / e);
        let o = (cell + 0.5 + look.clusterScatter * (g.xy - 0.5)) * side;
        t = smax(t, a * billows((p - o) / size, s + h.z, px / min(size.x, size.y), floor(64 * g.z)), look.clusterBlend);
      }
    }
  }
  return t;
}

// The thickness of cumulus k at q: big domes, breathing, on a flat base, under
// octaves of smaller ones. Odd ones have their domes mirrored, and each its
// own lobes.
fn billows(q: vec2f, s: f32, px: f32, k: f32) -> f32 {
  let n = arrayLength(&look.domes);
  var t = -1.0;
  for (var i = 0u; i < n; i++) {
    let dome = look.domes[i];
    let r = dome.z * (1 + look.breathe * sin(6.283 * (s + f32(i) / f32(n))));
    // Its height, or how far out of it q is.
    let d = length(q * vec2f(1 - 2 * (k % 2), 1) - dome.xy);
    t = smax(t, select(r - d, sqrt(r * r - d * d), d < r), look.domeBlend);
  }
  let body = smoothstep(0, 0.03, t);
  var f: f32 = look.lobeScale;
  for (var i = 1.0; i <= look.lobes; i += 1) {
    // Evened out where they'd be under two pixels.
    t += body * look.lobeHeight / f * mix(spheres(q * f + 9.1 * (i + k), s * i), 0.4, smoothstep(0.25, 0.5, px * f));
    f *= 2;
  }
  return min(t, look.base - q.y) - look.edge;
}

// The top of spheres at p, one per unit cell, merging where they meet, as s
// goes from 0 to 1: each drifts round a circle in its cell, swelling and
// shrinking.
fn spheres(p: vec2f, s: f32) -> f32 {
  let i = floor(p);
  var top = 0.0;
  for (var y = -1.0; y <= 1; y += 1) {
    for (var x = -1.0; x <= 1; x += 1) {
      let cell = i + vec2f(x, y);
      let h = hash(vec3f(cell, 0));
      let a = 6.283 * (s + h);
      let r = look.lobeRadius + look.lobeSpread * h.y + look.lobeSwell * sin(a.z);
      let d = length(p - cell - 0.5 - look.lobeDrift * vec2f(cos(a.x), sin(a.x)));
      top = smax(top, sqrt(max(r * r - d * d, 0)), look.lobeBlend);
    }
  }
  return top;
}

// CSS's cubic-bezier(c) at f, found by halving as the script's ease() does.
fn ease(c: array<f32, 4>, f: f32) -> f32 {
  var lo = 0.0;
  var hi = 1.0;
  for (var i = 0; i < 16; i++) {
    let s = (lo + hi) / 2;
    if (bezier(c[0], c[2], s) < f) {
      lo = s;
    } else {
      hi = s;
    }
  }
  return bezier(c[1], c[3], lo);
}

// The curve from 0 through control points a and b to 1, at s.
fn bezier(a: f32, b: f32, s: f32) -> f32 {
  return 3 * s * (1 - s) * (a * (1 - s) + b * s) + s * s * s;
}

// The larger of a and b, rounded where they're within k.
fn smax(a: f32, b: f32, k: f32) -> f32 {
  let m = max(k - abs(a - b), 0) / k;
  return max(a, b) + m * m * k / 4;
}

// Three hashes in [0, 1] of p's whole part.
fn hash(p: vec3f) -> vec3f {
  var v = bitcast<vec3u>(vec3i(p)) * 1664525u + 1013904223u;
  v += v.yzx * v.zxy;
  v ^= v >> vec3u(16);
  v += v.yzx * v.zxy;
  return vec3f(v) / 4294967295.0;
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
// as it allows: superelliptic, or round where they meet (a circle, a pill).
fn box(p: vec2f, h: vec2f, r: f32) -> f32 {
  let c = min(r, min(h.x, h.y));
  let q = abs(p) - h + c;
  let n = select(${2 ** SETTINGS.corner}, 2.0, r >= min(h.x, h.y));
  let o = max(q, vec2f());
  return pow(pow(o.x, n) + pow(o.y, n), 1 / n) + min(max(q.x, q.y), 0) - c;
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
  show: number;
  start?: number;
  // Texels per icon unit its labels were drawn at.
  texels?: number;
};

// Plays the icon last shown on `canvas` until stopped, each new one morphing
// out of the one before; `failed` without WebGPU.
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
    const requested = (await navigator.gpu?.requestAdapter())?.requestDevice();
    // Made while the device is on its way.
    const maps = Object.values(OUTLINES).map(depthMap);
    const device = await requested;
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
    const uniforms = new Float32Array(20);
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
    const outlines = device.createTexture({
      size: [MAP, MAP, maps.length],
      format: "rgba16float",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    maps.forEach((map, i) =>
      device.queue.writeTexture(
        { texture: outlines, origin: [0, 0, i] },
        map,
        { bytesPerRow: 8 * MAP },
        [MAP, MAP],
      ),
    );
    const sheet = new OffscreenCanvas(ICON.clip[0], ICON.clip[1]);
    const pen = sheet.getContext("2d")!;
    pen.fillStyle = "white";
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
      const style = getComputedStyle(canvas);
      const { color } = style;
      const { backgroundColor } = getComputedStyle(document.body);
      const clip = ["--clip-bg", "--clip-fg"].map((name) => style.getPropertyValue(name));
      const frame = shown.map(({ icon, start = now }) =>
        still
          ? 0
          : Math.floor(((now - start) / 1000) * ICON.fps) % Math.round(icon.duration * ICON.fps),
      );
      const state = `${frame.join()} ${shown.map((entry) => entry.show).join()} ${side} ${color} ${backgroundColor} ${clip.join()}`;
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
            { binding: 4, resource: outlines.createView({ dimension: "2d-array" }) },
          ],
        });
      }
      // rgb(), rgba() or color(srgb), premultiplied.
      const premultiplied = (css: string) => {
        const [r, g, b, a = 1] = css.match(/[\d.]+/g)!.map(Number);
        const k = css.startsWith("color(") ? 1 : 255;
        return [(r / k) * a, (g / k) * a, (b / k) * a, a];
      };
      const px = CELL / side;
      uniforms.set([
        ...premultiplied(color),
        ...premultiplied(backgroundColor),
        ...clip.flatMap(premultiplied),
        px,
        CELL / canvas.clientWidth,
      ]);
      device.queue.writeBuffer(uniformBuffer, 0, uniforms);
      // Labels centred on their ink, their baseline on a whole pixel, white for
      // the shader to colour.
      const texels = Math.min(side / CELL, TEXELS);
      for (const entry of shown) {
        if (entry.texels === texels) continue;
        entry.texels = texels;
        pen.font = font(texels);
        pen.letterSpacing = "0.08em";
        entry.icon.labels?.forEach((text, k) => {
          const ink = pen.measureText(text);
          pen.clearRect(0, 0, sheet.width, sheet.height);
          pen.fillText(
            text,
            Math.round((sheet.width + ink.actualBoundingBoxLeft - ink.actualBoundingBoxRight) / 2),
            Math.round(
              (sheet.height + ink.actualBoundingBoxAscent - ink.actualBoundingBoxDescent) / 2,
            ),
          );
          device.queue.copyExternalImageToTexture(
            { source: sheet },
            { texture: entry.texture, origin: [0, 0, k] },
            ICON.clip,
          );
        });
      }

      // A box with its straight edges on whole device pixels, bar any that
      // move on to the box a frame later.
      const snap = (box: Box, next = box): Box => {
        const [x, y, w, h, r] = box;
        const c = Math.min(r, w, h);
        const [x0, x1] =
          h > c && x === next[0] && w === next[2]
            ? [round(x - w, px), round(x + w, px)]
            : [x - w, x + w];
        const [y0, y1] =
          w > c && y === next[1] && h === next[3]
            ? [round(y - h, px), round(y + h, px)]
            : [y - h, y + h];
        return [(x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2, r];
      };
      // The keys mix into one, each over the ones before by its share so far,
      // eased so a lone morph follows the curve.
      const weights = shown.map((entry) => ease(entry.show));
      let total = 0;
      const shares = shown.map(({ show }) => ease(show / (total += show) || 0));
      const key = shown.reduce(
        (key, entry, i) => mix(key, snap(entry.icon.key), shares[i]),
        snap(shown[0].icon.key),
      );
      const draws = shown
        .flatMap((entry, i) => {
          const t = frame[i] / ICON.fps;
          // Each layer off by what snaps it at rest, so it moves smoothly and
          // lands sharp, unless it's moving at rest too.
          const [rest, next] = [t, t + 1 / ICON.fps].map((t) =>
            entry.icon.layers(t, 1, snap(entry.icon.key)),
          );
          return entry.icon.layers(t, weights[i], key).map((layer, n) => {
            const { at, size, radius = 0, turn, sweep } = rest[n];
            const box: Box = [...at, ...size, radius];
            const snapped =
              turn === undefined && sweep === undefined
                ? snap(box, [...next[n].at, ...next[n].size, radius])
                : box;
            return {
              entry,
              layer,
              shift: snapped.map((v, k) => v - box[k]),
              opacity: layer.z ? weights[i] : shares[i],
            };
          });
        })
        .sort((a, b) => a.layer.z - b.layer.z);
      draws.forEach(({ entry: { icon }, layer: l, shift, opacity }, n) => {
        packed.set(
          [
            ...[...l.at, ...l.size, l.radius ?? 0].map((v, k) => v + shift[k]),
            l.turn ?? 0,
            l.sweep ?? 0,
            Number(l.sweep !== undefined),
            (l.opacity ?? 1) * opacity,
            l.glass !== undefined ? 1 : l.ink !== undefined ? 2 : 0,
            l.glass ?? l.ink ?? 0,
            l.label ? icon.labels!.indexOf(l.label) : Object.keys(CLIPS).indexOf(l.clip ?? ""),
            l.frame ?? 0,
            l.next ?? l.frame ?? 0,
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
        // Glass and ink see what's under them.
        if ((layer.glass ?? layer.ink) !== undefined) {
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

    // An icon with a texture layer per label, once its font has loaded, and
    // its look as the shader's Cloud, the domes 16-byte aligned.
    const load = async (icon: Icon): Promise<Shown> => {
      if (icon.labels) await document.fonts.load(font(1));
      const texture = device.createTexture({
        size: [...ICON.clip, Math.max(icon.labels?.length ?? 0, 1)],
        format: "rgba8unorm",
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT,
      });
      const look = { ...CLOUD, ...icon.cloud };
      const numbers = FIELDS.flatMap((key) => look[key]);
      const offset = Math.ceil(numbers.length / 4) * 4;
      const cloud = new Float32Array(offset + 4 * look.domes.length);
      cloud.set(numbers);
      look.domes.forEach((dome, i) => cloud.set(dome, offset + 4 * i));
      const buffer = device.createBuffer({
        size: cloud.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(buffer, 0, cloud);
      return {
        icon,
        texture,
        group: device.createBindGroup({
          layout: pipeline.getBindGroupLayout(1),
          entries: [
            { binding: 0, resource: texture.createView({ dimension: "2d-array" }) },
            { binding: 1, resource: { buffer } },
          ],
        }),
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
