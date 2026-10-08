import type { MediaInfo } from "../ffmpeg.js";

export type Bounds = { x: number; y: number; width: number; height: number };

export const MARK = {
  // Square logo side fraction of the width and height geometric mean.
  sizeRatio: 0.064,
  // Long logo area exponent from equal area at 0 to equal short side at 1.
  elongationGain: 0.5,
  // Long logo side cap fraction of the matching frame side.
  maxSpan: 0.33,
  // Edge gap and glass padding fraction of the width and height geometric mean.
  paddingRatio: 0.05,

  // Frost blur fraction of the width and height minimum.
  blurRatio: 0.012,
  // Bevel blur floor fraction of the width and height minimum.
  minBlurRatio: 0.0008,
  // Frost saturation multiplier with no change at 1.
  saturation: 1.8,
  // Frost white mix.
  tint: 0.12,
  // Bevel width fraction of the logo width and height minimum.
  bevelRatio: 0.1,
  // Gain on a shape's blurred core; higher keeps thinner strokes refracting.
  coreGain: 14,
  // Steep bevel backdrop shift fraction of the logo width and height minimum.
  refractRatio: 1,
  // Red and blue edge shift split around green.
  chroma: 0.02,
  // Light direction in degrees clockwise from the top.
  lightAngle: -45,
  // Lit rim opacity.
  rimOpacity: 0.92,
  // Unlit rim brightness share of the lit rim.
  glint: 0.66,
  // Degrees the lit rim eases into glint over, ending side-on to the light.
  rimFalloff: 28,
  // Rim backdrop saturation multiplier with no change at 1.
  rimSaturation: 2,
  // Rim brightness multiplier.
  rimGain: 7,
  // Rim white mix with a plain white rim at 1.
  rimWhite: 0.4,
  // Rim paint blur fraction of the width and height minimum: how far round
  // the edge the rim gathers its backdrop colour from.
  rimBlurRatio: 0.0018,
  // Glass light opacity at the edge opposite the light.
  ambient: 0.12,
  // Ambient bevel width fraction of the logo width and height minimum: how far
  // in from the edges the glass light fades.
  ambientBevelRatio: 0.12,
  // Ambient shift towards the light in ambient bevels: more leaves the near
  // edge darker against the far one.
  ambientShift: 1,

  // Drop shadow blur fraction of the width and height minimum.
  shadowBlurRatio: 0.016,
  // Downward y-axis shadow offset fraction of the width and height minimum.
  shadowOffsetRatio: 0.016,
  // Drop shadow opacity.
  shadowOpacity: 0.08,
  // Logo pixel opacity over the glass.
  logoOpacity: 0.05,

  // Blur filter blur fraction of the width and height minimum.
  blurFilterRatio: 0.016,
  // Blur filter backdrop saturation multiplier with no change at 1.
  blurSaturation: 1.8,
  // Blur filter difference layer opacity, a white fill in the logo's shape.
  blurDifference: 0.12,

  // Rotation seconds at each position, fades included, at least: the clip
  // divides into equal stays.
  rotateCadence: 2,
  // Rotation fade in and fade out seconds, each.
  fadeSeconds: 0.25,
};

export const MARK_SIZES = {
  small: { scale: 0.66, gap: 1.2, rim: 0.66 },
  medium: { scale: 1, gap: 1, rim: 1 },
  large: { scale: 2, gap: 1, rim: 1 },
  dev: { scale: 3, gap: 1, rim: 1.33 },
};
export type MarkSize = keyof typeof MARK_SIZES;
export const isMarkSize = (value: unknown): value is MarkSize =>
  typeof value === "string" && Object.hasOwn(MARK_SIZES, value);

export const MARK_POSITIONS = {
  "top-left": [0, 0],
  top: [0.5, 0],
  "top-right": [1, 0],
  left: [0, 0.5],
  center: [0.5, 0.5],
  right: [1, 0.5],
  "bottom-left": [0, 1],
  bottom: [0.5, 1],
  "bottom-right": [1, 1],
};
export type MarkPosition = keyof typeof MARK_POSITIONS;
export const isMarkPosition = (value: unknown): value is MarkPosition =>
  typeof value === "string" && Object.hasOwn(MARK_POSITIONS, value);

export const MARK_FILTERS = ["plain", "glass", "blur"] as const;
export type MarkFilter = (typeof MARK_FILTERS)[number];
export const isMarkFilter = (value: unknown): value is MarkFilter =>
  MARK_FILTERS.includes(value as MarkFilter);

export const MARK_VIEWS = ["render", "displacement", "clear", "rim"] as const;
export type MarkView = (typeof MARK_VIEWS)[number];
export const isMarkView = (value: unknown): value is MarkView =>
  MARK_VIEWS.includes(value as MarkView);

const MARK_CLEAR: Partial<typeof MARK> = {
  blurRatio: 0,
  minBlurRatio: 0,
  saturation: 1,
  tint: 0,
  ambient: 0,
  shadowOpacity: 0,
  logoOpacity: 0,
  rimOpacity: 0,
};

const MARK_RIM: Partial<typeof MARK> = {
  ambient: 0,
  shadowOpacity: 0,
  logoOpacity: 0,
};

const DEBUG_BACKDROP = "0xD9D9D9";
const RIM_VIEW_DIM = 0.48;

const HD_HEIGHT = 720;

const SOBEL = {
  x: [-1, 0, 1, -2, 0, 2, -1, 0, 1],
  y: [-1, -2, -1, 0, 0, 0, 1, 2, 1],
};

const MERGE_GBR = "mergeplanes=map0s=0:map0p=0:map1s=1:map1p=0:map2s=2:map2p=0:format=gbrp";

// `margin` is the glass padding around the logo; `gap` its distance from the
// frame's edges, which the padding never overrides.
export function watermarkLayout(
  video: { width: number; height: number },
  bounds: { width: number; height: number },
  size: MarkSize = "medium",
  position: MarkPosition = "bottom-right",
): {
  VW: number;
  VH: number;
  LW: number;
  LH: number;
  margin: number;
  gap: number;
  LX: number;
  LY: number;
} {
  // Everything even: crop on subsampled yuv420p rounds odd sizes/offsets and
  // the patches must line up exactly.
  const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);
  const VW = even(video.width);
  const VH = even(video.height);
  const { scale, gap: gapScale } = MARK_SIZES[size];
  const mediumUnit = Math.sqrt(VW * VH);
  const unit = mediumUnit * scale;

  const aspect = bounds.width / bounds.height;
  const elongation = Math.max(aspect, 1 / aspect);
  const area = (unit * MARK.sizeRatio) ** 2 * elongation ** MARK.elongationGain;
  const w = Math.sqrt(area * aspect);
  const h = Math.sqrt(area / aspect);
  const clamp = Math.min(1, (MARK.maxSpan * VW) / w, (MARK.maxSpan * VH) / h);
  const LW = even(Math.round(w * clamp));
  const LH = even(Math.round(h * clamp));
  // Only bites on absurdly long frames: the cell must fit the frame.
  const fit = (n: number) => Math.min(n, Math.floor((VW - LW) / 2), Math.floor((VH - LH) / 2));
  const gap = fit(Math.round(mediumUnit * MARK.paddingRatio * gapScale));
  // The padding gives way to the gap (cell stays inside) and takes its parity
  // (corner even); bumping up stays within the gap, as it was below it.
  let margin = Math.min(fit(Math.round(unit * MARK.paddingRatio)), gap);
  if ((gap - margin) % 2) margin += 1;
  const [fx, fy] = MARK_POSITIONS[position];
  // Centred, the corner can land odd: a 1px nudge keeps it even.
  const along = (span: number, f: number) => {
    const at = gap + (span - 2 * gap) * f;
    return at - ((at - margin) % 2);
  };
  const LX = along(VW - LW, fx);
  const LY = along(VH - LH, fy);
  return { VW, VH, LW, LH, margin, gap, LX, LY };
}

// c' = (1-s)·luma + s·c. colorchannelmixer has no offset term, so tints are luts.
const LUMA: Record<string, number> = { r: 0.299, g: 0.587, b: 0.114 };
const saturation = (s: number) =>
  ["r", "g", "b"]
    .flatMap((o) =>
      ["r", "g", "b"].map((i) => `${o}${i}=${((1 - s) * LUMA[i] + (o === i ? s : 0)).toFixed(4)}`),
    )
    .join(":");
// colorchannelmixer caps coefficients at ±2 (a matrix hits that near s≈2.1),
// so larger saturations are split into equal chained passes.
const saturate = (s: number) => {
  const passes = Math.max(1, Math.ceil(Math.log(s) / Math.LN2));
  return Array<string>(passes)
    .fill(`colorchannelmixer=${saturation(s ** (1 / passes))}`)
    .join(",");
};

// Inputs [0] video, [1] logo; output [out]. Sizes are computed from the probe,
// not filter expressions, so the glass crops only the patch under the logo.
// `base` rgba keeps a GIF's transparency and odd sizes (yuv420p would lose both).
export function watermarkGraph(
  video: MediaInfo,
  logo: MediaInfo,
  {
    filter,
    bounds = { x: 0, y: 0, width: logo.width, height: logo.height },
    base = "yuv420p",
    pad = "[0:v]",
    size = "medium",
    position = "bottom-right",
    view = "render",
    rotatePosition = false,
  }: {
    filter: MarkFilter;
    bounds?: Bounds;
    base?: "yuv420p" | "rgba";
    pad?: string;
    size?: MarkSize;
    position?: MarkPosition;
    view?: MarkView;
    rotatePosition?: boolean;
  },
): string {
  const M =
    view === "clear"
      ? { ...MARK, ...MARK_CLEAR }
      : view === "rim"
        ? { ...MARK, ...MARK_RIM }
        : MARK;
  const layout = watermarkLayout(video, bounds, size, position);
  const { VW, VH, LW, LH, margin } = layout;
  // Rotating, the mark stops at every position in turn from `position` on, 4
  // along each time so it jumps across the frame. The clip divides into equal
  // stays, as many as rotateCadence fits but two at least, so it opens and
  // closes on a whole mark. A clip of unknown length stays put.
  const rotating = rotatePosition && video.duration > 0;
  const names = Object.keys(MARK_POSITIONS) as MarkPosition[];
  const stops = names.map((_, i) =>
    watermarkLayout(video, bounds, size, names[(names.indexOf(position) + 4 * i) % names.length]),
  );
  const stays = Math.max(2, Math.floor(video.duration / M.rotateCadence));
  const period = video.duration / stays;
  // Short stays keep half their time whole.
  const fade = Math.min(M.fadeSeconds, period / 4);
  // Frames past the probed length hold the last stay.
  const stop = `mod(min(floor(t/${period}),${stays - 1}),${stops.length})`;
  // The logo box's corner less `inset`, for crop and overlay.
  const corner = (inset = 0) =>
    (["LX", "LY"] as const).map((axis) =>
      rotating
        ? `'st(0,${stop});${stops.map((at, i) => `${at[axis] - inset}*eq(ld(0),${i})`).join("+")}'`
        : layout[axis] - inset,
    );
  // Ends a w×h rgba chain: clear at each move, fading out before it and in
  // after, whole at both ends of the clip. A 2px white clock off the video
  // holds the fade as its alpha (geq on the mark itself costs frames) and
  // multiplies into the mark.
  const lap = `mod(T,${period})`;
  const fading = (w: number, h: number) =>
    rotating
      ? `,format=gbrap[whole];${pad}crop=2:2,format=gbrap,geq=r=255:g=255:b=255:a='255*if(between(T,${fade},${video.duration - fade}),clip(min(${lap},${period}-${lap})/${fade},0,1),1)',scale=${w}:${h}:flags=neighbor[clock];[clock][whole]blend=all_mode=multiply`
      : "";
  const shorter = Math.min(VW, VH) * MARK_SIZES[size].scale;
  const trimmed = bounds.width < logo.width || bounds.height < logo.height;
  const trim = trimmed ? `,crop=${bounds.width}:${bounds.height}:${bounds.x}:${bounds.y}` : "";

  // Scaled premultiplied, else the (usually black) transparent pixels bleed
  // into the antialiased edge and rim a light logo in dark.
  const scaleLogo = `premultiply=inplace=1,scale=${LW}:${LH}:flags=lanczos,unpremultiply=inplace=1`;

  // Pin limited-range yuv420p first: full-range sources (JPEG frame grabs,
  // some phone footage) otherwise convert differently from the glass patch
  // and leave a faint box. RGBA overlays need format=auto (default is yuv420).
  const rgb = base === "rgba";
  const open = rgb ? "format=rgba" : `format=yuv420p,crop=${VW}:${VH}:0:0`;
  const onto = ([x, y]: (number | string)[]) =>
    rgb ? `overlay=x=${x}:y=${y}:format=auto,format=rgba` : `overlay=x=${x}:y=${y},format=yuv420p`;
  if (filter === "plain" && view === "render") {
    return [
      `${pad}${open}[base]`,
      `[1:v]format=rgba${trim},${scaleLogo}${fading(LW, LH)}[logo]`,
      `[base][logo]${onto(corner())}[out]`,
    ].join(";");
  }

  // The cell: logo box plus `margin` padding so shadow and blur can spill.
  const P = margin;
  const CW = LW + 2 * P;
  const CH = LH + 2 * P;
  const [CX, CY] = corner(P);

  // Same matrix both ways keeps the cell's colours; it must match the source's
  // tag too, or overlay converts the whole frame (a JPEG grab is always bt601).
  const matrix = video.matrix ?? (VH >= HD_HEIGHT ? "bt709" : "bt601");
  const toRgb = rgb ? "" : `scale=in_color_matrix=${matrix}:in_range=tv,`;
  const fromRgb = rgb ? "" : `,scale=out_color_matrix=${matrix}:out_range=tv,format=yuva420p`;

  // Frost only. A faint inverted backdrop (difference with white) keeps the
  // mark legible on white and black alike, whatever colour the logo is.
  if (filter === "blur" && view === "render") {
    return [
      `${pad}${open},split[base][src]`,
      `[src]crop=${CW}:${CH}:${CX}:${CY},${toRgb}format=rgba,gblur=sigma=${(shorter * M.blurFilterRatio).toFixed(2)}:steps=2,${saturate(M.blurSaturation)},split[frost][under]`,
      `[1:v]format=rgba${trim},${scaleLogo},pad=${CW}:${CH}:${P}:${P}:color=black@0,split[lg1][lg2]`,
      `[lg1]format=rgba,alphaextract,format=gray,split[mask][dmask]`,
      `[under]lutrgb=r=negval:g=negval:b=negval[inverted]`,
      `[inverted][dmask]alphamerge,colorchannelmixer=aa=${M.blurDifference}[difference]`,
      `[frost][difference]overlay=format=auto[lifted]`,
      `[lifted][mask]alphamerge[fill]`,
      `[lg2]colorchannelmixer=aa=${M.logoOpacity}[faint]`,
      `[fill][faint]overlay=format=auto${fading(CW, CH)}${fromRgb}[cell]`,
      `[base][cell]${onto([CX, CY])}[out]`,
    ].join(";");
  }

  const sigma = (shorter * M.blurRatio).toFixed(2);
  const minSigma = (shorter * M.minBlurRatio).toFixed(2);
  const rimSigma = (shorter * M.rimBlurRatio).toFixed(2);
  const shadowSigma = (shorter * M.shadowBlurRatio).toFixed(2);
  const shadowDy = Math.max(1, Math.round(shorter * M.shadowOffsetRatio));

  const reach = Math.ceil(3 * shorter * M.shadowBlurRatio) + shadowDy;
  const S = reach + ((reach + P) % 2);
  const [SW, SH] = [LW + 2 * S, LH + 2 * S];
  // One erosion pass per px, sized off the frame so a hairline stays one. A
  // fractional part blends in one more pass: an antialiased sub-pixel line.
  const rimWidth = Math.max(1, Math.round(Math.min(VW, VH) / HD_HEIGHT)) * MARK_SIZES[size].rim;
  const rimPx = Math.floor(rimWidth + 1e-6);
  const rimPart = rimWidth - rimPx;
  const erode = (passes: number) => Array<string>(passes).fill("erosion").join(",");
  const rimErode =
    rimPart < 0.01
      ? [`[m2]${erode(rimPx)}[eroded]`]
      : [
          `[m2]${rimPx ? `${erode(rimPx)},` : ""}split[er1][er2]`,
          `[er2]erosion[er3]`,
          `[er1][er3]blend=all_expr='A+(B-A)*${rimPart.toFixed(3)}'[eroded]`,
        ];

  // Refraction runs at 2×: remap moves whole pixels only, so at 1× the bevel
  // would step.
  const SS = 2;
  const [CW2, CH2, LW2, LH2, P2] = [CW, CH, LW, LH, P].map((n) => n * SS);
  // 16-bit lens: at 8 bits the heightfield's steps become rings across the
  // glass, and offsets can't pass ±127px.
  const FULL = 65535;
  const MID = 32768;
  // Wide + narrow blur, averaged: half height on a straight edge. Edge slope
  // is FULL/(σ√2π); the narrow one is 3× steeper, so the mean's 2×. Left
  // unclipped: clipping each blur at the edge's half height creased it along
  // that contour, which a convex corner pulls inwards, one arc per blur.
  const bevel = Math.min(LW, LH) * M.bevelRatio * SS;
  const edgeSlope = (2 * FULL) / (bevel * Math.sqrt(2 * Math.PI));
  // Edge→0, interior→FULL, for the bevel mask.
  const stretch = `lut=c0='clip((val-${MID})*2,0,${FULL})'`;
  // Thin strokes flattened: a stroke under ~bevel/2 never takes the narrow
  // blur past half height, so it has no core. The cores, blurred wide and
  // boosted, reach a thick shape's edges and corners at 1 and fade to 0 over
  // a stroke too thin to hold a bevel. It scales the slopes, not the field:
  // a gain falling along a taper would add a slope of its own.
  const thick = `${stretch},gblur=sigma=${bevel.toFixed(2)}:steps=2,lut=c0='st(0,clip(val*${(M.coreGain / FULL).toPrecision(6)},0,1));${FULL}*ld(0)*ld(0)*(3-2*ld(0))'`;
  // Reads [mk1] and [mk2]; one gain per slope, from [k1] on.
  const heightfield = (out: string, slopes: number) => [
    `[mk1]gblur=sigma=${bevel.toFixed(2)}:steps=2[hw]`,
    `[mk2]gblur=sigma=${(bevel / 3).toFixed(2)}:steps=2,split[hn][hc]`,
    `[hw][hn]blend=all_mode=average${out}`,
    `[hc]${thick},split=${slopes}${Array.from({ length: slopes }, (_, i) => `[k${i + 1}]`).join("")}`,
  ];
  // A slope around `bias`, scaled by gain [k<n>].
  const flatten = (n: number, bias: number) =>
    `[k${n}]blend=all_expr='${bias}+(A-${bias})*B/${FULL}'`;
  const lensMask = (n: number) =>
    `scale=${LW2}:${LH2}:flags=lanczos,pad=${CW2}:${CH2}:${P2}:${P2}:color=black@0,format=rgba,alphaextract,format=gray,format=gray16le,split=${n}${Array.from({ length: n }, (_, i) => `[mk${i + 1}]`).join("")}`;
  // Sobel sums 8× the slope, so this scale gives `shift` at the steepest edge.
  // convolution applies rdiv after summing, so the scale costs no precision.
  const refractPx = Math.min(LW, LH) * M.refractRatio * SS;
  const sobel = (axis: "x" | "y", shift: number) => {
    const scale = shift / (8 * edgeSlope);
    return `convolution=0m='${SOBEL[axis].join(" ")}':0rdiv=${scale.toPrecision(6)}:0bias=${MID}`;
  };
  // Offsets in 1/SUB px so the chroma split scales them before rounding.
  const SUB = 8;
  // remap coordinates, mirrored back in at the cell's edges.
  const sampleAt = (axis: "x" | "y", gain: number) => {
    const [c, n] = axis === "x" ? ["X", "W"] : ["Y", "H"];
    const at = `abs(${c}+(p(X,Y)-${MID})*${(gain / SUB).toPrecision(6)})`;
    return `geq=lum='st(0,${at});round(clip(if(gt(ld(0),${n}-1),2*(${n}-1)-ld(0),ld(0)),0,${n}-1))'`;
  };

  // Red = x, green = y, so no shift reads olive; full swing at the steepest
  // edge whatever refractRatio is.
  if (view === "displacement") {
    return [
      `${pad}${open},drawbox=w=iw:h=ih:color=${DEBUG_BACKDROP}:t=fill[base]`,
      `[1:v]format=rgba${trim},${lensMask(3)}`,
      ...heightfield(",split=3[hx][hy][hz]", 2),
      `[hx]${sobel("x", MID - 1)}[sx]`,
      `[sx]${flatten(1, MID)},format=gray[mx]`,
      `[hy]${sobel("y", MID - 1)}[sy]`,
      `[sy]${flatten(2, MID)},format=gray[my]`,
      `[hz]format=gray,lut=c0=0[mz]`,
      `[my][mz][mx]${MERGE_GBR},format=rgba[map]`,
      `[map][mk3]alphamerge,scale=${CW}:${CH}:flags=bicubic${fromRgb}[cell]`,
      `[base][cell]${onto([CX, CY])}[out]`,
    ].join(";");
  }
  const chroma = { r: 1 - M.chroma, g: 1, b: 1 + M.chroma };
  // Slope towards the light as one kernel (×100 for integer taps), scaled like
  // the lens so the steepest edge reads cos/sin(rimFalloff): full light up to
  // rimFalloff short of side-on, a cosine ramp from there. Saturated, the lit
  // side stepped hard into glint level at the light's sides.
  const angle = (M.lightAngle * Math.PI) / 180;
  const [lx, ly] = [Math.sin(angle), -Math.cos(angle)];
  const lightKernel = SOBEL.x
    .map((k, i) => Math.round(-100 * (k * lx + SOBEL.y[i] * ly)))
    .join(" ");
  const falloff = Math.sin((Math.min(Math.max(M.rimFalloff, 1), 90) * Math.PI) / 180);
  const lightScale = MID / (8 * 100 * edgeSlope * falloff);
  const lighting = `convolution=0m='${lightKernel}':0rdiv=${lightScale.toPrecision(6)}:0bias=${128 * 257}`;
  // Whole rim at glint level, lit side rising from there, smoothstepped so
  // both ends of the ramp blend in. A separate far-side ramp notched the rim
  // where edges turn side-on to the light.
  const rimLight = `lut=c0='st(0,clip((val-128)/127,0,1));${(255 * M.glint).toFixed(1)}+${(255 * (1 - M.glint)).toFixed(1)}*ld(0)*ld(0)*(3-2*ld(0))'`;
  // Glass light, an inner shadow in white: the logo blurred over a bevel of
  // its own, moved towards the light and inverted, inside the logo. It hugs
  // every edge, strongest on the far side, faint on the near one, and never
  // reaches a thick shape's middle. A slope across the same blur lit the
  // middle too, with a terminator through it.
  const ambientBevel = Math.min(LW, LH) * M.ambientBevelRatio;
  const shift = (n: number) => Math.round(n * ambientBevel * M.ambientShift);
  const [dx, dy] = [shift(lx), shift(ly)];
  const room = Math.max(Math.abs(dx), Math.abs(dy));
  const ambientGlow = `gblur=sigma=${Math.max(0.5, ambientBevel).toFixed(2)}:steps=2,pad=${CW + 2 * room}:${CH + 2 * room}:${room}:${room},crop=${CW}:${CH}:${room - dx}:${room - dy},negate`;
  // gray→rgba put the glow in r, moved to alpha under white.
  const ambientPaint = `format=rgba,colorchannelmixer=aa=0:ar=${M.ambient},lutrgb=r=255:g=255:b=255`;

  const whiten = (t: number, gain = 1) =>
    ["r", "g", "b"]
      .map(
        (c) =>
          `${c}='min(val*${gain.toFixed(3)},255)*${(1 - t).toFixed(3)}+${(255 * t).toFixed(1)}'`,
      )
      .join(":");
  const tint = whiten(M.tint);
  // Lifted towards white so the rim still reads as light on dark/grey video.
  const rimPaint = [saturate(M.rimSaturation), `lutrgb=${whiten(M.rimWhite, M.rimGain)}`].join(",");

  const keep = (1 - RIM_VIEW_DIM).toFixed(3);
  const dim = rgb
    ? `lutrgb=r=val*${keep}:g=val*${keep}:b=val*${keep}`
    : `lutyuv=y='16+(val-16)*${keep}':u='128+(val-128)*${keep}':v='128+(val-128)*${keep}'`;

  return [
    // The rim paints off the frame as it is; only what shows around it dims.
    view === "rim"
      ? `${pad}${open},split[undimmed][src];[undimmed]${dim}[base]`
      : `${pad}${open},split[base][src]`,
    // Both conversions name their matrix: on auto the way back falls to
    // bt601 and shifts the hue.
    `[src]crop=${CW}:${CH}:${CX}:${CY},${toRgb}format=rgba,split=3[cellA][cellB][cellC]`,
    `[cellB]colorchannelmixer=aa=0[canvas]`,
    // Explicit formats: after a split of an open-format scale output,
    // alphaextract/extractplanes can't negotiate one.
    `[1:v]format=rgba${trim},split=3[l1][l2][l3]`,
    `[l1]${scaleLogo},pad=${CW}:${CH}:${P}:${P}:color=black@0,split[lg1][lg2]`,
    `[lg1]format=rgba,alphaextract,format=gray,split=5[m1][m2][m3][m5][m6]`,
    `[l2]${lensMask(2)}`,
    ...heightfield(",split=4[h1][h2][h3][h4]", 3),
    `[h1]${sobel("x", refractPx * SUB)}[sx]`,
    `[sx]${flatten(1, MID)},split=3[hx1][hx2][hx3]`,
    `[hx1]${sampleAt("x", chroma.r)}[xr]`,
    `[hx2]${sampleAt("x", chroma.g)}[xg]`,
    `[hx3]${sampleAt("x", chroma.b)}[xb]`,
    `[h2]${sobel("y", refractPx * SUB)}[sy]`,
    `[sy]${flatten(2, MID)},split=3[hy1][hy2][hy3]`,
    `[hy1]${sampleAt("y", chroma.r)}[yr]`,
    `[hy2]${sampleAt("y", chroma.g)}[yg]`,
    `[hy3]${sampleAt("y", chroma.b)}[yb]`,
    `[cellA]scale=${CW2}:${CH2}:flags=bicubic,format=gbrp,extractplanes=r+g+b[pr][pg][pb]`,
    `[pr]format=gray[cr]`,
    `[pg]format=gray[cg]`,
    `[pb]format=gray[cb]`,
    // remap repeats the maps' last frame, so they're computed once.
    `[cr][xr][yr]remap=format=gray[dr]`,
    `[cg][xg][yg]remap=format=gray[dg]`,
    `[cb][xb][yb]remap=format=gray[db]`,
    `[dg][db][dr]${MERGE_GBR},scale=${CW}:${CH}:flags=bicubic,format=rgba[refracted]`,
    // The heightfield's tail runs past the logo's edge, so only the logo's
    // shape refracts: the blurs below then pull in the backdrop as it is
    // around the glass, which gives the rim the colour it sits on.
    `[refracted][m6]alphamerge[inside]`,
    `[cellC][inside]overlay=format=auto,split=3[rf1][rf2][rf3]`,
    // Frost on the flat, barely blurred on the bevel (inverted heightfield).
    `[rf1]gblur=sigma=${sigma}:steps=2[frost]`,
    `[h3]${stretch},format=gray,scale=${CW}:${CH}:flags=bicubic,negate[bevelMask]`,
    `[rf2]gblur=sigma=${minSigma}:steps=1[soft]`,
    `[soft][bevelMask]alphamerge[bevel]`,
    `[frost][bevel]overlay=format=auto,colorchannelmixer=${saturation(M.saturation)},lutrgb=${tint}[fill]`,
    `[fill][m1]alphamerge${view === "rim" ? ",colorchannelmixer=aa=0" : ""}[glass]`,
    // Paint softened first so the rim's colour doesn't flicker with detail.
    `[h4]${lighting}[sl]`,
    `[sl]${flatten(3, 128 * 257)},format=gray,scale=${CW}:${CH}:flags=bicubic,${rimLight}[light]`,
    ...rimErode,
    `[m3][eroded]blend=all_mode=subtract[band]`,
    `[light][band]blend=all_mode=multiply[rimAlpha]`,
    `[rf3]gblur=sigma=${rimSigma}:steps=1,${rimPaint}[paint]`,
    `[paint][rimAlpha]alphamerge,colorchannelmixer=aa=${M.rimOpacity}[rim]`,
    `[m5]split[am1][am2]`,
    `[am1]${ambientGlow}[as]`,
    `[am2][as]blend=all_mode=multiply,${ambientPaint}[ambient]`,
    `[lg2]colorchannelmixer=aa=${M.logoOpacity}[faint]`,
    // Layers go on a transparent canvas so only covered pixels change: no
    // conversion round trip can leave a faint box.
    `[canvas][glass]overlay=format=auto[c2a]`,
    `[c2a][ambient]overlay=format=auto[c2]`,
    `[c2][rim]overlay=format=auto[c3]`,
    `[c3][faint]overlay=format=auto${fading(CW, CH)}${fromRgb}[cell]`,
    `[l3]${scaleLogo},pad=${SW}:${SH}:${S}:${S + shadowDy}:color=black@0,format=rgba,gblur=sigma=${shadowSigma}:steps=2,colorchannelmixer=rr=0:gg=0:bb=0:aa=${M.shadowOpacity}${fading(SW, SH)}${fromRgb}[shadow]`,
    `[base][shadow]${onto(corner(S))}[shaded]`,
    `[shaded][cell]${onto([CX, CY])}[out]`,
  ].join(";");
}

// bbox logs e.g. "... x1:50 x2:349 y1:160 y2:239 ..."; a fully transparent
// logo logs none, giving the whole image.
export function parseBounds(log: string, width: number, height: number): Bounds {
  const m = / x1:(\d+) x2:(\d+) y1:(\d+) y2:(\d+)/.exec(log);
  const [x1, x2, y1, y2] = (m ?? []).slice(1).map(Number);
  if (!m || x2 < x1 || y2 < y1 || x2 >= width || y2 >= height) {
    return { x: 0, y: 0, width, height };
  }
  return { x: x1, y: y1, width: x2 - x1 + 1, height: y2 - y1 + 1 };
}
