import type { MediaInfo } from "../ffmpeg.js";

// The pure half of the mark tool: where the logo goes and the filtergraph
// that puts it there. No I/O, so the tests drive it directly.

// A rectangle inside an image, in its pixels.
export type Bounds = { x: number; y: number; width: number; height: number };

// Watermark layout and look, all relative to the video so the mark reads the
// same at every resolution. Position is fixed to the bottom-right corner.
// (Exported for the tests, which check the layout against these values
// rather than pinning numbers, so tuning them here doesn't break anything.)
export const MARK = {
  // Layout (see watermarkLayout). Lengths are fractions of the frame's
  // "unit", the geometric mean of its width and height, so the mark takes
  // the same share of a landscape, portrait or square picture. The logo is
  // measured by its visible pixels (see logoBounds), not its canvas.
  // Size is an area budget rather than a fitting box: a 1:1 logo is drawn
  // this fraction of the unit on each side, and every other shape gets the
  // same area times elongation^elongationGain, where elongation is the long
  // side over the short one (so wide and tall are treated alike, and no
  // ratio is special). At gain 0 every logo covers the same area; at 1
  // every logo has the same short side (all logotypes one height, however
  // long). In between, elongated logos, which are mostly thin strokes and
  // gaps, gain some area so they don't read lighter than a dense square.
  sizeRatio: 0.064,
  elongationGain: 0.5,
  // Safety bound for banner-like logos (and wide ones on portrait video):
  // neither side is drawn past this fraction of the frame's matching side.
  // A third still clears a 4:1 logotype on portrait video.
  maxSpan: 0.33,
  // The gap to the frame edges, a fraction of the unit and the same for
  // every logo: sizes are already evened out, so nothing about the shape
  // needs to feed back into it. It is also the glass cell's padding, the
  // room the shadow and blur spill into.
  paddingRatio: 0.05,
  // Glass mode. The logo's alpha becomes a lens: a heightfield that rises
  // from 0 at the edge to full over the bevel, whose slope refracts the video
  // underneath (each pixel is pulled in from just outside the edge, the way a
  // thick slab bends what's behind its rim) and catches the light along the
  // rim; the flat interior is frosted.
  // Frost: the refracted backdrop is blurred by this sigma (fraction of the
  // shorter side; the CSS analogue is backdrop-filter: blur()), then
  // saturated and mixed with white. Light enough that the bending at the
  // bevel still reads through it.
  blurRatio: 0.012, //0.012
  // Floor for the blur, same unit (1.6px at 1080p): what the bevel gets
  // instead of the full frost. Small islands and thin strokes are bevel all
  // the way through, so without it hard backdrop edges cut straight across
  // them; big shapes still ramp from this at the rim to blurRatio inside.
  minBlurRatio: 0.0008, //0.0015
  saturation: 1.8, //1.35
  tint: 0.12, //0.22
  // Bevel width, as a fraction of the logo's shorter drawn side rather than
  // of the frame: a bevel wider than a logotype's strokes would flatten them
  // away. The profile is the mean of a wide and a narrow (÷3) blur of the
  // alpha, so thick shapes get a steep rim easing into the flat middle and
  // thin strokes still keep a usable slope.
  bevelRatio: 0.1, //0.1
  // Displacement of the backdrop at the steepest part of the bevel, as a
  // fraction of the shorter side; it eases to none over the bevel. displace
  // moves at most 127 map px (63px of video at the 2× the lens runs at), so
  // anything past about 0.059 also flattens the top of the curve: more of
  // the bevel bends by the full amount, which is the thick-lens look.
  refractRatio: 0.088, //0.088
  // Chromatic split: red is displaced (1 − chroma)×, blue (1 + chroma)×,
  // green as is. Subtle on purpose, a hint of colour on contrasty edges.
  chroma: 0.08, //0.15
  // Where the light comes from, in degrees clockwise from the top (−45 is
  // top-left), and the rim it lights: a stroke along the inside of the edge
  // (1px at 720p, scaling up) at rimOpacity where the edge faces the light,
  // easing down around the shape to the glint: the level (this fraction of
  // it) the rest of the rim holds, so the outline never breaks.
  lightAngle: -45, //-45
  rimOpacity: 0.85, //0.85
  glint: 0.66, //0.35
  // What the rim is painted with: not white but the backdrop under it,
  // saturated by rimSaturation (the same scale as `saturation`: 1 leaves
  // it, 0 is grey), brightened by rimGain like a colour dodge, then mixed
  // this far towards white. The gain does most of the work: it keeps the
  // hue and lifts the rim clear of the video, where more saturation alone
  // turns the rim into the backdrop's own colour and it disappears. At
  // rimWhite 1 it is a plain white rim.
  rimSaturation: 2, //1.4
  rimGain: 7, //3
  rimWhite: 0.6, //0.15
  // Ambient light across the glass, for depth when the video under it is
  // flat: a radial gradient from the side opposite lightAngle (bottom-right
  // under the default top-left light), white there at this opacity, fading
  // through nothing to black on the light's own side at ambientShade
  // of it (shade reads heavier than light, so it gets less). ambientReach is
  // the gradient's radius in logo radii; the centre sits one radius outside
  // the logo, so at 2 it would end at the logo's far edge, and a bit more
  // keeps the far side from going fully dark and the curve shallow.
  ambient: 0.16, //0.16
  ambientShade: 0.5, //0.5
  ambientReach: 2.4, //2.4
  // Soft drop shadow behind the glass shape, offset downwards.
  shadowBlurRatio: 0.016, //0.012
  shadowOffsetRatio: 0.016, //0.006
  shadowOpacity: 0.08, //0.35
  // The logo's own pixels over the glass: a white logo brightens it, a dark
  // one smokes it, a coloured one tints it.
  logoOpacity: 0.07, //0.45
};

// Where the logo goes and how big, from the frame and the logo's visible
// bounds alone (see MARK for the model). One continuous formula: the
// logo's aspect ratio sets how an area budget is split between its sides,
// and the padding doesn't depend on the logo at all.
export function watermarkLayout(
  video: { width: number; height: number },
  bounds: { width: number; height: number },
): {
  VW: number;
  VH: number;
  LW: number;
  LH: number;
  margin: number;
  LX: number;
  LY: number;
} {
  // Frame size floored to even for yuv420p (odd-sized sources exist), and
  // every patch size/offset kept even too: crop on a subsampled source
  // rounds them otherwise, and the patches must line up exactly.
  const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);
  const VW = even(video.width);
  const VH = even(video.height);
  const unit = Math.sqrt(VW * VH);

  const aspect = bounds.width / bounds.height;
  const elongation = Math.max(aspect, 1 / aspect);
  const area =
    (unit * MARK.sizeRatio) ** 2 * elongation ** MARK.elongationGain;
  const w = Math.sqrt(area * aspect);
  const h = Math.sqrt(area / aspect);
  const clamp = Math.min(1, (MARK.maxSpan * VW) / w, (MARK.maxSpan * VH) / h);
  const LW = even(Math.round(w * clamp));
  const LH = even(Math.round(h * clamp));
  // (The bound only bites on absurdly long frames, where the unit is many
  // times the short side: the glass cell, logo plus this padding on every
  // side, has to fit the frame.)
  const margin = Math.min(
    Math.round(unit * MARK.paddingRatio),
    Math.floor((VW - LW) / 2),
    Math.floor((VH - LH) / 2),
  );
  // The logo's top-left corner in the frame.
  const LX = VW - margin - LW;
  const LY = VH - margin - LH;
  return { VW, VH, LW, LH, margin, LX, LY };
}

// Builds the watermark filtergraph (inputs: [0] video, [1] logo; output
// [out]). Every dimension is computed here from the probed sizes rather
// than with filter expressions, so the glass pipeline can crop just the
// patch of video under the logo instead of blurring whole frames.
export function watermarkGraph(
  video: MediaInfo,
  logo: MediaInfo,
  filter: boolean,
  bounds: Bounds = { x: 0, y: 0, width: logo.width, height: logo.height },
): string {
  const { VW, VH, LW, LH, margin, LX, LY } = watermarkLayout(
    video,
    bounds,
  );
  const shorter = Math.min(VW, VH);
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
  if (!filter) {
    return [
      `[0:v]format=yuv420p,crop=${VW}:${VH}:0:0[base]`,
      `[1:v]format=rgba${trim},${scaleLogo}[logo]`,
      `[base][logo]overlay=x=${LX}:y=${LY},format=yuv420p[out]`,
    ].join(";");
  }

  // The glass is built on a "cell": the logo box plus `margin` of padding
  // on every side, so shadow and blur have room to spill. The cell reaches
  // the frame edge exactly, never past it.
  const P = margin;
  const CW = LW + 2 * P;
  const CH = LH + 2 * P;
  const CX = LX - P;
  const CY = LY - P;

  // One YUV↔RGB matrix for the cell's way in and back: the source's own
  // when it is tagged (a JPEG frame grab is bt601 at any size), else the
  // usual HD/SD convention. Being the same both ways is what keeps the
  // cell's colours; matching the tag matters on ffmpeg 7, where links
  // carry a colour space and a cell tagged differently from the base makes
  // overlay convert the whole frame (and a JPEG cannot say it is bt709).
  const matrix = video.matrix ?? (VH >= 720 ? "bt709" : "bt601");
  const sigma = (shorter * MARK.blurRatio).toFixed(2);
  const minSigma = (shorter * MARK.minBlurRatio).toFixed(2);
  const shadowSigma = (shorter * MARK.shadowBlurRatio).toFixed(2);
  const shadowDy = Math.max(1, Math.round(shorter * MARK.shadowOffsetRatio));
  // Rim width in px: each erosion pass eats one pixel off the mask.
  const rimPx = Math.max(1, Math.round(shorter / 720));

  // The lens maps are built at 2× and the refraction runs there: displace
  // moves whole pixels only, so at 1× the bevel would step. Everything
  // else (frost, rim, shadow, the faint logo) stays at 1×.
  const SS = 2;
  const [CW2, CH2, LW2, LH2, P2] = [CW, CH, LW, LH, P].map((n) => n * SS);
  // Heightfield: the 2× alpha blurred wide and narrow, each remapped so the
  // edge (a blurred step sits at 128 there) is 0 and the interior 255, and
  // averaged. A blurred step's slope at the edge is 2·255/(σ√2π) per px
  // after the remap; the narrow blur is 3× steeper, so the mean's is 2×.
  const bevel = Math.min(LW, LH) * MARK.bevelRatio * SS;
  const edgeSlope = (2 * 2 * 255) / (bevel * Math.sqrt(2 * Math.PI));
  const remap = "lut=c0='clip((val-128)*2,0,255)'";
  // Sobel sums 8× the slope; scaled by refractPx/(8·edgeSlope) that is
  // pixels of displacement (in 2× space) around 128, which displace reads
  // as none. The kernels are the negated derivatives: the backdrop is
  // sampled outward, down the slope, like light bending in at a lens's rim.
  // The scale cannot go through convolution's rdiv: ffmpeg 6.1 (the
  // Windows ffmpeg-static binary) ignores a given rdiv and divides by the
  // kernel's sum (1 for these), 7.0 (the Linux one, so Vercel) applies it,
  // and the lens has to come out the same on both. So rdiv stays 1 and the
  // gain is split: its fraction scales the heightfield beforehand, its
  // whole part multiplies the integer taps. That runs in 16 bits so the
  // fraction costs no precision, with a lut bringing the result back to
  // the 8-bit map (×256+128: exact through the gray16→gray conversion
  // whether or not it dithers).
  const refractPx = shorter * MARK.refractRatio * SS;
  const SOBEL = {
    x: [1, 0, -1, 2, 0, -2, 1, 0, -1],
    y: [1, 2, 1, 0, 0, 0, -1, -2, -1],
  };
  const sobel = (axis: "x" | "y", gain: number) => {
    const scale = (refractPx * gain) / (8 * edgeSlope);
    const whole = Math.max(1, Math.ceil(scale));
    return [
      "format=gray16le",
      `lut=c0='val*${(scale / whole).toFixed(5)}'`,
      `convolution=0m='${SOBEL[axis].map((k) => k * whole).join(" ")}':0rdiv=1:0bias=32768`,
      "lut=c0='clip(round((val-32768)/257)+128,0,255)*256+128'",
      "format=gray",
    ].join(",");
  };
  const chroma = { r: 1 - MARK.chroma, g: 1, b: 1 + MARK.chroma };
  // Edge light: the heightfield's derivative towards the light, as one
  // kernel (the two Sobels weighted by the light vector, ×100 for integer
  // taps). Left at that gain it saturates: any edge facing the light at
  // all is fully lit, any facing away fully dark, and the downscale to 1×
  // softens the line between them. (rdiv=1 for the same reason as above.)
  const angle = (MARK.lightAngle * Math.PI) / 180;
  const [lx, ly] = [Math.sin(angle), -Math.cos(angle)];
  // Ambient gradient over the fill: radial, centred one logo radius off
  // the logo on the side away from the light (the glow a lens gathers
  // opposite its highlight) and reaching ambientReach radii out, so
  // across the logo it reads as a gently curved linear ramp. As a geq
  // expression it runs from +1 at the centre to −1 at the reach (and past
  // it); the logo spans roughly the top of that range to a little under 0.
  const radius = Math.hypot(LW, LH) / 2;
  const [ax, ay] = [CW / 2 - lx * radius, CH / 2 - ly * radius];
  const ambientS = `(1-2*min(hypot(X-${ax.toFixed(1)},Y-${ay.toFixed(1)})/${(radius * MARK.ambientReach).toFixed(1)},1))`;
  const KX = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
  const KY = [-1, -2, -1, 0, 0, 0, 1, 2, 1];
  const lightKernel = KX.map((k, i) =>
    Math.round(-100 * (k * lx + KY[i] * ly)),
  ).join(" ");
  const lighting = `convolution=0m='${lightKernel}':0rdiv=1:0bias=128`;
  // The whole rim sits at the glint level and the lit side (above 128)
  // rises from there to full white. A glint that ramped up separately on
  // the far side left the rim notched wherever an edge turns through
  // side-on to the light (a diamond's corners under a 45° light), as both
  // ramps start from nothing there.
  const rimLight = `lut=c0='clip(${(255 * MARK.glint).toFixed(1)}+${(1 - MARK.glint).toFixed(3)}*max(0,(val-128)*2),0,255)'`;

  // Saturation as an RGB matrix (colorchannelmixer has no offset term, so
  // the white tint is a separate lut): c' = (1-s)·luma + s·c.
  const lum: Record<string, number> = { r: 0.299, g: 0.587, b: 0.114 };
  const saturation = (s: number) =>
    ["r", "g", "b"]
      .flatMap((o) =>
        ["r", "g", "b"].map(
          (i) =>
            `${o}${i}=${((1 - s) * lum[i] + (o === i ? s : 0)).toFixed(4)}`,
        ),
      )
      .join(":");
  const whiten = (t: number, gain = 1) =>
    ["r", "g", "b"]
      .map(
        (c) =>
          `${c}='min(val*${gain.toFixed(3)},255)*${(1 - t).toFixed(3)}+${(255 * t).toFixed(1)}'`,
      )
      .join(":");
  const saturate = saturation(MARK.saturation);
  const tint = whiten(MARK.tint);
  // The rim's paint: the backdrop under it pushed far past natural
  // saturation, brightened, then lifted towards white so it still reads
  // as light on a dark or grey video. colorchannelmixer caps coefficients
  // at ±2, which a single matrix passes at about 2.1; saturations multiply
  // when chained, so a bigger one is split into equal passes under 2.
  const passes = Math.max(
    1,
    Math.ceil(Math.log(MARK.rimSaturation) / Math.LN2),
  );
  const rimPaint = [
    ...Array<string>(passes).fill(
      `colorchannelmixer=${saturation(MARK.rimSaturation ** (1 / passes))}`,
    ),
    `lutrgb=${whiten(MARK.rimWhite, MARK.rimGain)}`,
  ].join(",");

  return [
    `[0:v]format=yuv420p,crop=${VW}:${VH}:0:0,split[base][src]`,
    // The patch of video under the cell, to refract, and a transparent
    // canvas of the same size and timing to stack the layers on. Both
    // colour conversions (here and on the way back) name their matrix:
    // left to auto, the way in follows the source's tag (bt709 on most HD
    // files) and the way back falls to bt601, which shifts the hue.
    `[src]crop=${CW}:${CH}:${CX}:${CY},scale=in_color_matrix=${matrix}:in_range=tv,format=rgba,split[cellA][cellB]`,
    `[cellB]colorchannelmixer=aa=0[canvas]`,
    // The logo scaled and centred in a transparent cell-sized canvas, at
    // 1× (the faint copy and the masks) and at 2× (the lens maps). The
    // explicit formats pin the negotiation: a split of an open-format
    // scale output leaves alphaextract/extractplanes unable to choose.
    `[1:v]format=rgba${trim},split[l1][l2]`,
    `[l1]${scaleLogo},pad=${CW}:${CH}:${P}:${P}:color=black@0,split[lg1][lg2]`,
    `[lg1]format=rgba,alphaextract,format=gray,split=5[m1][m2][m3][m4][m5]`,
    `[l2]scale=${LW2}:${LH2}:flags=lanczos,pad=${CW2}:${CH2}:${P2}:${P2}:color=black@0,format=rgba,alphaextract,format=gray,split=3[mk1][mk2][mk3]`,
    // Heightfield, clipped to the alpha so nothing rises outside the shape.
    `[mk1]gblur=sigma=${bevel.toFixed(2)}:steps=2,${remap}[hw]`,
    `[mk2]gblur=sigma=${(bevel / 3).toFixed(2)}:steps=2,${remap}[hn]`,
    `[hw][hn]blend=all_mode=average[hb]`,
    `[hb][mk3]blend=all_mode=multiply,split=4[h1][h2][h3][h4]`,
    // Displacement maps, a pair per channel for the chromatic split.
    `[h1]split=3[hx1][hx2][hx3]`,
    `[hx1]${sobel("x", chroma.r)}[xr]`,
    `[hx2]${sobel("x", chroma.g)}[xg]`,
    `[hx3]${sobel("x", chroma.b)}[xb]`,
    `[h2]split=3[hy1][hy2][hy3]`,
    `[hy1]${sobel("y", chroma.r)}[yr]`,
    `[hy2]${sobel("y", chroma.g)}[yg]`,
    `[hy3]${sobel("y", chroma.b)}[yb]`,
    // Refraction: the patch at 2×, each channel displaced by its own maps,
    // reassembled (gbrp plane order) and brought back to 1×.
    `[cellA]scale=${CW2}:${CH2}:flags=bicubic,format=gbrp,extractplanes=r+g+b[pr][pg][pb]`,
    `[pr]format=gray[cr]`,
    `[pg]format=gray[cg]`,
    `[pb]format=gray[cb]`,
    // (displace stops with its source and repeats the maps, which is what
    // a still logo needs.)
    `[cr][xr][yr]displace=edge=mirror[dr]`,
    `[cg][xg][yg]displace=edge=mirror[dg]`,
    `[cb][xb][yb]displace=edge=mirror[db]`,
    `[dg][db][dr]mergeplanes=map0s=0:map0p=0:map1s=1:map1p=0:map2s=2:map2p=0:format=gbrp,scale=${CW}:${CH}:flags=bicubic,format=rgba,split=3[rf1][rf2][rf3]`,
    // Frosted fill: blurred where the heightfield is flat, the barely
    // blurred (minBlurRatio) refracted backdrop where it is still rising
    // (the bevel, laid over the frost with the inverted heightfield as its
    // alpha); then saturated and lightened, and shaped by the logo's alpha.
    `[rf1]gblur=sigma=${sigma}:steps=2[frost]`,
    `[h3]scale=${CW}:${CH}:flags=bicubic,negate[bevelMask]`,
    `[rf2]gblur=sigma=${minSigma}:steps=1[soft]`,
    `[soft][bevelMask]alphamerge[bevel]`,
    `[frost][bevel]overlay=format=auto,colorchannelmixer=${saturate},lutrgb=${tint}[fill]`,
    `[fill][m1]alphamerge[glass]`,
    // Rim: the mask minus itself eroded by a pixel or so, lit by the
    // edge's slope towards the light, painted with the vivid backdrop
    // (softened first, so the stroke's colour doesn't flicker with detail).
    `[h4]${lighting},scale=${CW}:${CH}:flags=bicubic,${rimLight}[light]`,
    `[m2]${Array<string>(rimPx).fill("erosion").join(",")}[eroded]`,
    `[m3][eroded]blend=all_mode=subtract[band]`,
    `[light][band]blend=all_mode=multiply[rimAlpha]`,
    `[rf3]gblur=sigma=${minSigma}:steps=1,${rimPaint}[paint]`,
    `[paint][rimAlpha]alphamerge,colorchannelmixer=aa=${MARK.rimOpacity}[rim]`,
    // Ambient gradient: white towards the light, black away from it, with
    // the mask (which the gray→rgba conversion put in r) as its alpha.
    `[m5]format=rgba,geq=r='255*gt(${ambientS},0)':g='255*gt(${ambientS},0)':b='255*gt(${ambientS},0)':a='r(X,Y)*abs(${ambientS})*if(gt(${ambientS},0),${MARK.ambient},${(MARK.ambient * MARK.ambientShade).toFixed(3)})'[ambient]`,
    // Shadow: the mask blurred, painted black, offset downwards on overlay.
    `[m4]gblur=sigma=${shadowSigma}:steps=2,split[sk1][sk2]`,
    `[sk1]format=rgba,lutrgb=r=0:g=0:b=0[black]`,
    `[black][sk2]alphamerge,colorchannelmixer=aa=${MARK.shadowOpacity}[shadow]`,
    `[lg2]colorchannelmixer=aa=${MARK.logoOpacity}[faint]`,
    // Stack the layers on the transparent canvas and lay that on the
    // frame: only pixels the glass or its shadow cover are touched, so no
    // conversion round trip can leave the cell showing as a faint box.
    `[canvas][shadow]overlay=x=0:y=${shadowDy}:format=auto[c1]`,
    `[c1][glass]overlay=format=auto[c2a]`,
    `[c2a][ambient]overlay=format=auto[c2]`,
    `[c2][rim]overlay=format=auto[c3]`,
    `[c3][faint]overlay=format=auto,scale=out_color_matrix=${matrix}:out_range=tv,format=yuva420p[cell]`,
    `[base][cell]overlay=x=${CX}:y=${CY},format=yuv420p[out]`,
  ].join(";");
}

// Parses bbox's log line, e.g.
//   [Parsed_bbox_2 @ 0x...] n:0 pts:0 pts_time:0 x1:50 x2:349 y1:160
//     y2:239 w:300 h:80 crop=300:80:50:160 drawbox=50:160:300:80
// A logo with nothing visible logs no coordinates; the bounds are then the
// whole image.
export function parseBounds(log: string, width: number, height: number): Bounds {
  const m = / x1:(\d+) x2:(\d+) y1:(\d+) y2:(\d+)/.exec(log);
  const [x1, x2, y1, y2] = (m ?? []).slice(1).map(Number);
  if (!m || x2 < x1 || y2 < y1 || x2 >= width || y2 >= height) {
    return { x: 0, y: 0, width, height };
  }
  return { x: x1, y: y1, width: x2 - x1 + 1, height: y2 - y1 + 1 };
}
