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
  // Steep bevel backdrop shift fraction of the logo width and height minimum.
  refractRatio: 1.0,
  // Red and blue edge shift split around green.
  chroma: 0.02,
  // Light direction in degrees clockwise from the top.
  lightAngle: -45,
  // Lit rim opacity.
  rimOpacity: 0.8,
  // Unlit rim brightness share of the lit rim.
  glint: 0.66,
  // Rim backdrop saturation multiplier with no change at 1.
  rimSaturation: 2,
  // Rim brightness multiplier.
  rimGain: 7,
  // Rim white mix with a plain white rim at 1.
  rimWhite: 0.4,
  // Glass light opacity on the side opposite the light.
  ambient: 0.12,
  // Shade side opacity share of the bright side.
  ambientShade: 0.5,
  // Ambient gradient radius in logo radii from a point outside the logo.
  ambientReach: 1.8,

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
};

// The mark's size choice: MARK is tuned as the large one, and the small one
// is it scaled down by `scale`. Every length MARK gives as a fraction of the
// frame (the logo, the glass padding, the frost, the shadow) scales alike,
// as do the bevel and refraction, fractions of the logo, so a small glass
// is the large one shrunk rather than a heavier-edged one. The gap to the frame's corner is the large
// one's times `gap` instead: a small mark sits a little further in. The
// rim, a hairline sized off the frame alone, is the large one's times
// `rim`, and may come to a fraction of a pixel. The dev one, twice the large,
// is for looking at the glass up close (the client's debug mode only).
export const MARK_SIZES = {
  small: { scale: 0.66, gap: 1.2, rim: 0.66 },
  large: { scale: 1, gap: 1, rim: 1 },
  dev: { scale: 2, gap: 1, rim: 1 },
};
export type MarkSize = keyof typeof MARK_SIZES;
export const isMarkSize = (value: unknown): value is MarkSize =>
  typeof value === "string" && Object.hasOwn(MARK_SIZES, value);

// The mark's look: the logo laid on as is, a glass lens in its shape (see
// MARK), or the backdrop frosted in its shape with none of the lens.
export const MARK_FILTERS = ["plain", "glass", "blur"] as const;
export type MarkFilter = (typeof MARK_FILTERS)[number];
export const isMarkFilter = (value: unknown): value is MarkFilter =>
  MARK_FILTERS.includes(value as MarkFilter);

// What the graph shows: the mark as rendered, or, for debugging the glass,
// the lens's displacement map on its own over a flat light-gray frame, or
// the glass cleared of everything but its refraction and rim (MARK_CLEAR).
export const MARK_VIEWS = ["render", "displacement", "clear"] as const;
export type MarkView = (typeof MARK_VIEWS)[number];
export const isMarkView = (value: unknown): value is MarkView =>
  MARK_VIEWS.includes(value as MarkView);

// The clear view's overrides of MARK: no frost, colour change, light, shadow
// or logo in the way of the refraction, which is left as tuned.
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

// The displacement view's stand-in for the frame: light enough that the map's
// neutral olive stands apart from it.
const DEBUG_BACKDROP = "0xD9D9D9";

// Frames this tall and up are HD: the glass's matrix and rim go by it.
const HD_HEIGHT = 720;

// The Sobel kernels, 3×3 row by row: the heightfield's slope along each axis.
const SOBEL = {
  x: [-1, 0, 1, -2, 0, 2, -1, 0, 1],
  y: [-1, -2, -1, 0, 0, 0, 1, 2, 1],
};

// Three gray planes, in gbrp's plane order (g, b, r), as one picture.
const MERGE_GBR =
  "mergeplanes=map0s=0:map0p=0:map1s=1:map1p=0:map2s=2:map2p=0:format=gbrp";

// Where the logo goes and how big, from the frame and the logo's visible
// bounds alone (see MARK for the model). One continuous formula: the
// logo's aspect ratio sets how an area budget is split between its sides,
// and the padding doesn't depend on the logo at all. `margin` is the glass
// padding around the logo; `gap`, the logo's distance from the right and
// bottom edges, is the same for the large size and bigger for smaller ones.
export function watermarkLayout(
  video: { width: number; height: number },
  bounds: { width: number; height: number },
  size: MarkSize = "large",
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
  // Frame size floored to even for yuv420p (odd-sized sources exist), and
  // every patch size/offset kept even too: crop on a subsampled source
  // rounds them otherwise, and the patches must line up exactly.
  const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);
  const VW = even(video.width);
  const VH = even(video.height);
  const { scale, gap: gapScale } = MARK_SIZES[size];
  const largeUnit = Math.sqrt(VW * VH);
  const unit = largeUnit * scale;

  const aspect = bounds.width / bounds.height;
  const elongation = Math.max(aspect, 1 / aspect);
  const area = (unit * MARK.sizeRatio) ** 2 * elongation ** MARK.elongationGain;
  const w = Math.sqrt(area * aspect);
  const h = Math.sqrt(area / aspect);
  const clamp = Math.min(1, (MARK.maxSpan * VW) / w, (MARK.maxSpan * VH) / h);
  const LW = even(Math.round(w * clamp));
  const LH = even(Math.round(h * clamp));
  // (The bound only bites on absurdly long frames, where the unit is many
  // times the short side: the glass cell, logo plus this padding on every
  // side, has to fit the frame.)
  const fit = (n: number) =>
    Math.min(n, Math.floor((VW - LW) / 2), Math.floor((VH - LH) / 2));
  const margin = fit(Math.round(unit * MARK.paddingRatio));
  // The gap is taken off the large padding. It is at least the margin, so the cell never passes the edge, and of the
  // same parity, so the cell's corner stays even.
  let gap = fit(Math.round(largeUnit * MARK.paddingRatio * gapScale));
  if ((gap - margin) % 2) gap -= 1;
  gap = Math.max(gap, margin);
  // The logo's top-left corner in the frame.
  const LX = VW - gap - LW;
  const LY = VH - gap - LH;
  return { VW, VH, LW, LH, margin, gap, LX, LY };
}

// Saturation as an RGB matrix (colorchannelmixer has no offset term, so a
// white tint is a separate lut): c' = (1-s)·luma + s·c.
const LUMA: Record<string, number> = { r: 0.299, g: 0.587, b: 0.114 };
const saturation = (s: number) =>
  ["r", "g", "b"]
    .flatMap((o) =>
      ["r", "g", "b"].map(
        (i) => `${o}${i}=${((1 - s) * LUMA[i] + (o === i ? s : 0)).toFixed(4)}`,
      ),
    )
    .join(":");
// A saturation of any size as colorchannelmixer passes. It caps
// coefficients at ±2, which a single matrix passes at about 2.1;
// saturations multiply when chained, so a bigger one is split into equal
// passes under 2.
const saturate = (s: number) => {
  const passes = Math.max(1, Math.ceil(Math.log(s) / Math.LN2));
  return Array<string>(passes)
    .fill(`colorchannelmixer=${saturation(s ** (1 / passes))}`)
    .join(",");
};

// Builds the watermark filtergraph (inputs: [0] video, [1] logo; output
// [out]). Every dimension is computed here from the probed sizes rather
// than with filter expressions, so the glass pipeline can crop just the
// patch of video under the logo instead of blurring whole frames.
//
// `base` is the pixel format the frame is composited in. Video is yuv420p,
// which is what its encoders write. A GIF goes back out as RGB frames, so it
// stays RGBA from end to end: through yuv420p it would lose its
// transparency, have its colours subsampled, and an odd-sized one a pixel.
//
// `pad` names the video among the inputs: the first input's first video
// stream unless the caller knows better (encode/render.ts, videoPad).
//
// `filter` picks one of MARK_FILTERS; `size` one of MARK_SIZES; `view` one
// of MARK_VIEWS (a debug view shows the glass whatever the filter).
// `bounds` is the logo's visible part (the whole image unless given).
export function watermarkGraph(
  video: MediaInfo,
  logo: MediaInfo,
  {
    filter,
    bounds = { x: 0, y: 0, width: logo.width, height: logo.height },
    base = "yuv420p",
    pad = "[0:v]",
    size = "large",
    view = "render",
  }: {
    filter: MarkFilter;
    bounds?: Bounds;
    base?: "yuv420p" | "rgba";
    pad?: string;
    size?: MarkSize;
    view?: MarkView;
  },
): string {
  const M = view === "clear" ? { ...MARK, ...MARK_CLEAR } : MARK;
  const { VW, VH, LW, LH, margin, LX, LY } = watermarkLayout(
    video,
    bounds,
    size,
  );
  // The frame's short side, scaled with the mark like the layout's unit:
  // the glass's frame-relative lengths are measured against it.
  const shorter = Math.min(VW, VH) * MARK_SIZES[size].scale;
  // The logo cut down to its visible pixels, which is what the layout
  // measured; nothing to cut when they fill the canvas.
  const trimmed = bounds.width < logo.width || bounds.height < logo.height;
  const trim = trimmed
    ? `,crop=${bounds.width}:${bounds.height}:${bounds.x}:${bounds.y}`
    : "";

  // The logo is scaled premultiplied and turned back to straight alpha:
  // scaled as is, the (usually black) colour of its transparent pixels
  // bleeds into the antialiased edge and rims a light logo in dark.
  const scaleLogo = `premultiply=inplace=1,scale=${LW}:${LH}:flags=lanczos,unpremultiply=inplace=1`;

  // The base is pinned to limited-range yuv420p before anything else:
  // full-range sources (JPEG stills from the preview's frame grab, some
  // phone footage) would otherwise reach the final overlay through a
  // different conversion than the glass patch and leave a faint box.
  // An RGBA base needs none of that, nor the crop to even dimensions; the
  // overlays then have to be told not to fall back to their yuv420 default.
  const rgb = base === "rgba";
  const open = rgb ? "format=rgba" : `format=yuv420p,crop=${VW}:${VH}:0:0`;
  const onto = (x: number, y: number) =>
    rgb
      ? `overlay=x=${x}:y=${y}:format=auto,format=rgba`
      : `overlay=x=${x}:y=${y},format=yuv420p`;
  if (filter === "plain" && view === "render") {
    return [
      `${pad}${open}[base]`,
      `[1:v]format=rgba${trim},${scaleLogo}[logo]`,
      `[base][logo]${onto(LX, LY)}[out]`,
    ].join(";");
  }

  // The glass is built on a "cell": the logo box plus `margin` of padding
  // on every side, so shadow and blur have room to spill. The large cell
  // reaches the frame edge exactly; a smaller one stops short of it.
  const P = margin;
  const CW = LW + 2 * P;
  const CH = LH + 2 * P;
  const CX = LX - P;
  const CY = LY - P;

  // One YUV↔RGB matrix for the cell's way in and back: the source's own
  // when it is tagged (a JPEG frame grab is bt601 at any size), else the
  // usual HD/SD convention. Being the same both ways is what keeps the
  // cell's colours; matching the tag matters too, as links carry a colour
  // space and a cell tagged differently from the base makes overlay
  // convert the whole frame (and a JPEG cannot say it is bt709).
  const matrix = video.matrix ?? (VH >= HD_HEIGHT ? "bt709" : "bt601");
  const toRgb = rgb ? "" : `scale=in_color_matrix=${matrix}:in_range=tv,`;
  const fromRgb = rgb
    ? ""
    : `,scale=out_color_matrix=${matrix}:out_range=tv,format=yuva420p`;

  // Blur: the glass's frost alone. The patch under the cell blurred (by
  // blurFilterRatio, its own, not the glass's) and made more vibrant
  // (blurSaturation), shaped by the logo's
  // alpha, with the faint logo over it; no lens, rim, light or shadow. The
  // fill is the only thing with alpha, so as with the glass nothing outside
  // the logo's shape changes.
  //
  // For legibility a white fill in the logo's shape is laid over the frost
  // in difference mode at blurDifference: |B-255| is the backdrop
  // inverted, so at that opacity a white backdrop darkens and a black one
  // lightens under the mark, whatever colour the logo is. (A difference
  // with the logo's own colours would leave a black logo on black as it
  // is.) Mid-grey is its own inverse and stays put, but needs no help.
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
      `[fill][faint]overlay=format=auto${fromRgb}[cell]`,
      `[base][cell]${onto(CX, CY)}[out]`,
    ].join(";");
  }

  const sigma = (shorter * M.blurRatio).toFixed(2);
  const minSigma = (shorter * M.minBlurRatio).toFixed(2);
  const shadowSigma = (shorter * M.shadowBlurRatio).toFixed(2);
  const shadowDy = Math.max(1, Math.round(shorter * M.shadowOffsetRatio));
  // Rim width in px: each erosion pass eats one pixel off the mask. (Off
  // the frame alone, not the scaled mark: a hairline stays a hairline.) A
  // fraction of a pixel takes the mask one pass further and mixes that
  // share of it in, so the last pixel of the band is only partly covered:
  // what an antialiased line that thin comes to.
  const rimWidth =
    Math.max(1, Math.round(Math.min(VW, VH) / HD_HEIGHT)) * MARK_SIZES[size].rim;
  const rimPx = Math.floor(rimWidth + 1e-6);
  const rimPart = rimWidth - rimPx;
  const erode = (passes: number) =>
    Array<string>(passes).fill("erosion").join(",");
  const rimErode =
    rimPart < 0.01
      ? [`[m2]${erode(rimPx)}[eroded]`]
      : [
          `[m2]${rimPx ? `${erode(rimPx)},` : ""}split[er1][er2]`,
          `[er2]erosion[er3]`,
          `[er1][er3]blend=all_expr='A+(B-A)*${rimPart.toFixed(3)}'[eroded]`,
        ];

  // The lens maps are built at 2× and the refraction runs there: remap
  // moves whole pixels only, so at 1× the bevel would step. Everything
  // else (frost, rim, shadow, the faint logo) stays at 1×.
  const SS = 2;
  const [CW2, CH2, LW2, LH2, P2] = [CW, CH, LW, LH, P].map((n) => n * SS);
  // The lens is 16-bit from the 2× alpha on. At 8 bits the heightfield
  // rises a level at a time, which the refraction's gain turns into jumps
  // of tens of pixels (rings across the glass), and an offset map for
  // displace can't pass ±127px, which a bevel refracting by the logo's
  // width does many times over (a band at the rim shifted all alike).
  const FULL = 65535;
  const MID = 32768;
  // Heightfield: the 2× alpha blurred wide and narrow, each stretched so
  // the edge (a blurred step sits at MID there) is 0 and the interior FULL,
  // and averaged. A blurred step's slope at the edge is 2·FULL/(σ√2π) per
  // px after the stretch; the narrow blur is 3× steeper, so the mean's 2×.
  const bevel = Math.min(LW, LH) * M.bevelRatio * SS;
  const edgeSlope = (2 * 2 * FULL) / (bevel * Math.sqrt(2 * Math.PI));
  const stretch = `lut=c0='clip((val-${MID})*2,0,${FULL})'`;
  // From three copies of the 2× alpha ([mk1] to [mk3]), clipped to it so
  // nothing rises outside the shape; `out` finishes the last filter.
  const heightfield = (out: string) => [
    `[mk1]gblur=sigma=${bevel.toFixed(2)}:steps=2,${stretch}[hw]`,
    `[mk2]gblur=sigma=${(bevel / 3).toFixed(2)}:steps=2,${stretch}[hn]`,
    `[hw][hn]blend=all_mode=average[hb]`,
    `[hb][mk3]blend=all_mode=multiply${out}`,
  ];
  // The logo's alpha at 2×, centred in the 2× cell, split `n` ways as [mk…].
  const lensMask = (n: number) =>
    `scale=${LW2}:${LH2}:flags=lanczos,pad=${CW2}:${CH2}:${P2}:${P2}:color=black@0,format=rgba,alphaextract,format=gray,format=gray16le,split=${n}${Array.from({ length: n }, (_, i) => `[mk${i + 1}]`).join("")}`;
  // Sobel sums 8× the slope; scaled by shift/(8·edgeSlope) it comes to
  // `shift` at the steepest edge, around MID. The kernels are the negated
  // derivatives: the backdrop is sampled outward, down the slope, like
  // light bending in at a lens's rim. convolution sums the integer taps in
  // full and only then applies rdiv and rounds, so the scale costs no
  // precision there.
  const refractPx = Math.min(LW, LH) * M.refractRatio * SS;
  const sobel = (axis: "x" | "y", shift: number) => {
    const scale = shift / (8 * edgeSlope);
    return `convolution=0m='${SOBEL[axis].join(" ")}':0rdiv=${scale.toPrecision(6)}:0bias=${MID}`;
  };
  // The glass's offsets are in SUB-ths of a pixel (in 2× space), so the
  // chroma split scales them before they round: at most refractPx·SUB,
  // well inside the 16 bits for any logo that fits a frame.
  const SUB = 8;
  // A map of where remap samples along `axis`: the pixel's own coordinate
  // plus the offset map's shift times `gain`, mirrored back in at the
  // cell's edges and kept inside it.
  const sampleAt = (axis: "x" | "y", gain: number) => {
    const [c, n] = axis === "x" ? ["X", "W"] : ["Y", "H"];
    const at = `abs(${c}+(p(X,Y)-${MID})*${(gain / SUB).toPrecision(6)})`;
    return `geq=lum='st(0,${at});round(clip(if(gt(ld(0),${n}-1),2*(${n}-1)-ld(0),ld(0)),0,${n}-1))'`;
  };

  // Displacement view: the lens's offsets, red the x map and green the y
  // (the green channel's, the middle of the chroma split), blue empty as in
  // the usual red-green map, so no shift reads as olive (128,128,0). Each
  // swings fully at the steepest edge's refractPx, so the map reads the
  // same whatever the refraction's strength. Brought to 1× and shaped by
  // the logo's alpha, which is all of them the glass keeps, over the frame
  // painted light gray.
  if (view === "displacement") {
    return [
      `${pad}${open},drawbox=w=iw:h=ih:color=${DEBUG_BACKDROP}:t=fill[base]`,
      `[1:v]format=rgba${trim},${lensMask(4)}`,
      ...heightfield(",split=3[hx][hy][hz]"),
      `[hx]${sobel("x", MID - 1)},format=gray[mx]`,
      `[hy]${sobel("y", MID - 1)},format=gray[my]`,
      `[hz]format=gray,lut=c0=0[mz]`,
      `[my][mz][mx]${MERGE_GBR},format=rgba[map]`,
      `[map][mk4]alphamerge,scale=${CW}:${CH}:flags=bicubic${fromRgb}[cell]`,
      `[base][cell]${onto(CX, CY)}[out]`,
    ].join(";");
  }
  const chroma = { r: 1 - M.chroma, g: 1, b: 1 + M.chroma };
  // Edge light: the heightfield's derivative towards the light, as one
  // kernel (the two Sobels weighted by the light vector, ×100 for integer
  // taps). Left at that gain it saturates: any edge facing the light at
  // all is fully lit, any facing away fully dark, and the downscale to 1×
  // softens the line between them.
  const angle = (M.lightAngle * Math.PI) / 180;
  const [lx, ly] = [Math.sin(angle), -Math.cos(angle)];
  // Ambient gradient over the fill: radial, centred one logo radius off
  // the logo on the side away from the light (the glow a lens gathers
  // opposite its highlight) and reaching ambientReach radii out, so
  // across the logo it reads as a gently curved linear ramp. As a geq
  // expression it runs from +1 at the centre to −1 at the reach (and past
  // it); the logo spans roughly the top of that range to a little under 0.
  const radius = Math.hypot(LW, LH) / 2;
  const [ax, ay] = [CW / 2 - lx * radius, CH / 2 - ly * radius];
  const ambientS = `(1-2*min(hypot(X-${ax.toFixed(1)},Y-${ay.toFixed(1)})/${(radius * M.ambientReach).toFixed(1)},1))`;
  const lightKernel = SOBEL.x.map((k, i) =>
    Math.round(-100 * (k * lx + SOBEL.y[i] * ly)),
  ).join(" ");
  const lighting = `convolution=0m='${lightKernel}':0rdiv=1:0bias=128`;
  // The whole rim sits at the glint level and the lit side (above 128)
  // rises from there to full white. A glint that ramped up separately on
  // the far side left the rim notched wherever an edge turns through
  // side-on to the light (a diamond's corners under a 45° light), as both
  // ramps start from nothing there.
  const rimLight = `lut=c0='clip(${(255 * M.glint).toFixed(1)}+${(1 - M.glint).toFixed(3)}*max(0,(val-128)*2),0,255)'`;

  const whiten = (t: number, gain = 1) =>
    ["r", "g", "b"]
      .map(
        (c) =>
          `${c}='min(val*${gain.toFixed(3)},255)*${(1 - t).toFixed(3)}+${(255 * t).toFixed(1)}'`,
      )
      .join(":");
  const tint = whiten(M.tint);
  // The rim's paint: the backdrop under it pushed far past natural
  // saturation, brightened, then lifted towards white so it still reads
  // as light on a dark or grey video.
  const rimPaint = [
    saturate(M.rimSaturation),
    `lutrgb=${whiten(M.rimWhite, M.rimGain)}`,
  ].join(",");

  return [
    `${pad}${open},split[base][src]`,
    // The patch of video under the cell, to refract, and a transparent
    // canvas of the same size and timing to stack the layers on. Both
    // colour conversions (here and on the way back) name their matrix:
    // left to auto, the way in follows the source's tag (bt709 on most HD
    // files) and the way back falls to bt601, which shifts the hue.
    // (An RGBA base has no conversion to name. What the glass refracts is
    // the colour of the pixels under it, so over transparent ones it shows
    // whatever colour the file keeps there.)
    `[src]crop=${CW}:${CH}:${CX}:${CY},${toRgb}format=rgba,split[cellA][cellB]`,
    `[cellB]colorchannelmixer=aa=0[canvas]`,
    // The logo scaled and centred in a transparent cell-sized canvas, at
    // 1× (the faint copy and the masks) and at 2× (the lens maps). The
    // explicit formats pin the negotiation: a split of an open-format
    // scale output leaves alphaextract/extractplanes unable to choose.
    `[1:v]format=rgba${trim},split[l1][l2]`,
    `[l1]${scaleLogo},pad=${CW}:${CH}:${P}:${P}:color=black@0,split[lg1][lg2]`,
    `[lg1]format=rgba,alphaextract,format=gray,split=5[m1][m2][m3][m4][m5]`,
    `[l2]${lensMask(3)}`,
    ...heightfield(",split=4[h1][h2][h3][h4]"),
    // Offset maps, one per axis, and from them where each channel samples,
    // a pair per channel for the chromatic split.
    `[h1]${sobel("x", refractPx * SUB)},split=3[hx1][hx2][hx3]`,
    `[hx1]${sampleAt("x", chroma.r)}[xr]`,
    `[hx2]${sampleAt("x", chroma.g)}[xg]`,
    `[hx3]${sampleAt("x", chroma.b)}[xb]`,
    `[h2]${sobel("y", refractPx * SUB)},split=3[hy1][hy2][hy3]`,
    `[hy1]${sampleAt("y", chroma.r)}[yr]`,
    `[hy2]${sampleAt("y", chroma.g)}[yg]`,
    `[hy3]${sampleAt("y", chroma.b)}[yb]`,
    // Refraction: the patch at 2×, each channel remapped by its own maps,
    // reassembled (gbrp plane order) and brought back to 1×.
    `[cellA]scale=${CW2}:${CH2}:flags=bicubic,format=gbrp,extractplanes=r+g+b[pr][pg][pb]`,
    `[pr]format=gray[cr]`,
    `[pg]format=gray[cg]`,
    `[pb]format=gray[cb]`,
    // (remap stops with its source and repeats the maps, which is what a
    // still logo needs: they are worked out once.)
    `[cr][xr][yr]remap=format=gray[dr]`,
    `[cg][xg][yg]remap=format=gray[dg]`,
    `[cb][xb][yb]remap=format=gray[db]`,
    `[dg][db][dr]${MERGE_GBR},scale=${CW}:${CH}:flags=bicubic,format=rgba,split=3[rf1][rf2][rf3]`,
    // Frosted fill: blurred where the heightfield is flat, the barely
    // blurred (minBlurRatio) refracted backdrop where it is still rising
    // (the bevel, laid over the frost with the inverted heightfield as its
    // alpha); then saturated and lightened, and shaped by the logo's alpha.
    `[rf1]gblur=sigma=${sigma}:steps=2[frost]`,
    `[h3]format=gray,scale=${CW}:${CH}:flags=bicubic,negate[bevelMask]`,
    `[rf2]gblur=sigma=${minSigma}:steps=1[soft]`,
    `[soft][bevelMask]alphamerge[bevel]`,
    `[frost][bevel]overlay=format=auto,colorchannelmixer=${saturation(M.saturation)},lutrgb=${tint}[fill]`,
    `[fill][m1]alphamerge[glass]`,
    // Rim: the mask minus itself eroded by a pixel or so, lit by the
    // edge's slope towards the light, painted with the vivid backdrop
    // (softened first, so the stroke's colour doesn't flicker with detail).
    `[h4]format=gray,${lighting},scale=${CW}:${CH}:flags=bicubic,${rimLight}[light]`,
    ...rimErode,
    `[m3][eroded]blend=all_mode=subtract[band]`,
    `[light][band]blend=all_mode=multiply[rimAlpha]`,
    `[rf3]gblur=sigma=${minSigma}:steps=1,${rimPaint}[paint]`,
    `[paint][rimAlpha]alphamerge,colorchannelmixer=aa=${M.rimOpacity}[rim]`,
    // Ambient gradient: white towards the light, black away from it, with
    // the mask (which the gray→rgba conversion put in r) as its alpha.
    `[m5]format=rgba,geq=r='255*gt(${ambientS},0)':g='255*gt(${ambientS},0)':b='255*gt(${ambientS},0)':a='r(X,Y)*abs(${ambientS})*if(gt(${ambientS},0),${M.ambient},${(M.ambient * M.ambientShade).toFixed(3)})'[ambient]`,
    // Shadow: the mask blurred, painted black, offset downwards on overlay.
    `[m4]gblur=sigma=${shadowSigma}:steps=2,split[sk1][sk2]`,
    `[sk1]format=rgba,lutrgb=r=0:g=0:b=0[black]`,
    `[black][sk2]alphamerge,colorchannelmixer=aa=${M.shadowOpacity}[shadow]`,
    `[lg2]colorchannelmixer=aa=${M.logoOpacity}[faint]`,
    // Stack the layers on the transparent canvas and lay that on the
    // frame: only pixels the glass or its shadow cover are touched, so no
    // conversion round trip can leave the cell showing as a faint box.
    `[canvas][shadow]overlay=x=0:y=${shadowDy}:format=auto[c1]`,
    `[c1][glass]overlay=format=auto[c2a]`,
    `[c2a][ambient]overlay=format=auto[c2]`,
    `[c2][rim]overlay=format=auto[c3]`,
    `[c3][faint]overlay=format=auto${fromRgb}[cell]`,
    `[base][cell]${onto(CX, CY)}[out]`,
  ].join(";");
}

// Parses bbox's log line, e.g.
//   [Parsed_bbox_2 @ 0x...] n:0 pts:0 pts_time:0 x1:50 x2:349 y1:160
//     y2:239 w:300 h:80 crop=300:80:50:160 drawbox=50:160:300:80
// A logo with nothing visible logs no coordinates; the bounds are then the
// whole image.
export function parseBounds(
  log: string,
  width: number,
  height: number,
): Bounds {
  const m = / x1:(\d+) x2:(\d+) y1:(\d+) y2:(\d+)/.exec(log);
  const [x1, x2, y1, y2] = (m ?? []).slice(1).map(Number);
  if (!m || x2 < x1 || y2 < y1 || x2 >= width || y2 >= height) {
    return { x: 0, y: 0, width, height };
  }
  return { x: x1, y: y1, width: x2 - x1 + 1, height: y2 - y1 + 1 };
}
