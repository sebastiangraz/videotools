// No imports: the client reads these too.

export type AmbientGlow = { bevelRatio: number; opacity: number; core?: boolean; ignoreBlend?: boolean };

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
  saturation: 1.64,
  // Frost white mix.
  tint: 0.02,
  // Bevel width fraction of the logo width and height minimum.
  bevelRatio: 0.1,
  // Gain on a shape's blurred core; higher keeps thinner strokes refracting.
  coreGain: 5,
  // Steep bevel backdrop shift fraction of the logo width and height minimum.
  refractRatio: 1,
  // Refraction share kept where the core gain fades, on a stroke too thin
  // for a bevel.
  thinRefract: 0.46,
  // Red and blue edge shift split around green.
  chroma: 0.02,
  // Light direction in degrees clockwise from the top.
  lightAngle: -60,
  // Lit rim opacity.
  rimOpacity: 0.88,
  // Unlit rim (glint) opacity, the far side from the light.
  glint: 0.58,
  // Degrees around side-on to the light where neither rim nor glint shows.
  rimGap: 1,
  // Degrees the rim eases out over into the gap, and the glint in over out of it.
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
  // Glass light as stacked glows, each fading in from the edges over its bevel
  // (fraction of the logo width and height minimum) at its opacity: narrow and
  // strong at the edge, wide and faint further in. A `core` glow fades out
  // with the lens on strokes too thin for a bevel (coreGain), which it would
  // otherwise fill. An `ignoreBlend` glow skips ambientBlend and is laid over
  // the glass in white, so it still shows on a near-black backdrop.
  ambient: [
    { bevelRatio: 0.02, opacity: 0.09, core: true, ignoreBlend: true },
    { bevelRatio: 0.025, opacity: 0.24, core: true },
    { bevelRatio: 0.12, opacity: 0.06, core: true, ignoreBlend: true },
    { bevelRatio: 0.225, opacity: 0.12 },
  ] as AmbientGlow[],
  // Ambient shift towards the light in each glow's bevels: more leaves the
  // near edge darker against the far one.
  ambientShift: 1,
  // How the glows meet the glass: "normal" lays white over it, fading its
  // colour; "plus-lighter" adds light, keeping the backdrop's hue until a
  // channel clips.
  ambientBlend: "plus-lighter" as "normal" | "plus-lighter",
  // Plus-lighter light colour from white at 0 to the glass's own at 1: white
  // clips light backdrops' bright channels first and washes them out.
  ambientTint: 0.44,

  // Drop shadow blur fraction of the width and height minimum.
  shadowBlurRatio: 0.016,
  // Downward y-axis shadow offset fraction of the width and height minimum.
  shadowOffsetRatio: 0.016,
  // Drop shadow opacity.
  shadowOpacity: 0.08,

  // Blur filter blur fraction of the width and height minimum.
  blurFilterRatio: 0.016,
  // Blur filter backdrop saturation multiplier with no change at 1.
  blurSaturation: 1.8,
  // Blur filter difference layer opacity, a white fill in the logo's shape.
  blurDifference: 0.12,
  // Blur filter logo pixel opacity over the frost.
  blurLogoOpacity: 0.05,

  // Rotation seconds at each position, fades included, at least: the clip
  // divides into equal stays.
  rotateCadence: 2,
  // Rotation fade in and fade out seconds, each.
  fadeSeconds: 0.25,
};

// `uncapped` lifts the maxSpan cap, the logo kept only inside the frame.
export type MarkSizeSpec = { scale: number; gap: number; rim: number; uncapped?: boolean };

export const MARK_SIZES = {
  small: { scale: 0.66, gap: 1.2, rim: 0.66 },
  medium: { scale: 1, gap: 1, rim: 1 },
  large: { scale: 2, gap: 1, rim: 1 },
  dev: { scale: 3, gap: 1, rim: 1.33 },
};
export type MarkSize = keyof typeof MARK_SIZES;
export const isMarkSize = (value: unknown): value is MarkSize =>
  typeof value === "string" && Object.hasOwn(MARK_SIZES, value);

// Where along the frame's width and height the logo sits, 0 to 1.
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

// The MARK values debug mode turns, each kept to its [min, max].
export const MARK_TUNING = {
  coreGain: [1, 40],
  thinRefract: [0, 1],
} satisfies Partial<Record<keyof typeof MARK, [number, number]>>;
export type MarkTuning = Partial<Record<keyof typeof MARK_TUNING, number>>;
