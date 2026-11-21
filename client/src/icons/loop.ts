import type { Icon } from "../icon";
import { ICON } from "../tools";
import clip from "./clip-mov.avif";

// The clip looped the way core/tools/loop.ts does it, starting at its middle:
// below with the crossfade, on top without, cutting hard where the fade ends.
// In frames; the loop is the clip less the fade, as its first frames only
// exist blended.
const CLIP = 3 * ICON.fps;
const FADE = ICON.fps / 2;
const START = CLIP / 2;
const PERIOD = CLIP - FADE;

export default {
  duration: PERIOD / ICON.fps,
  clips: { clip },
  shader: /* wgsl */ `
const SIZE = vec2f(56, 31.5);

// A pane at the origin, its playhead line below.
fn pane(c: vec4f, p: vec2f, image: vec4f, played: f32) -> vec4f {
  let d = box(p - SIZE / 2, SIZE / 2, 6);
  var out = over(c, image * fill(d));
  out = over(out, ink(0.16) * stroke(d, 1));
  let line = box(p - vec2f(28, 34), vec2f(28, 0.5), 0);
  out = over(out, ink(0.16) * fill(line));
  return over(out, ink(0.4) * fill(max(line, p.x - played)));
}

fn icon(p: vec2f) -> vec4f {
  let i = round(u.t * FPS);
  let frame = select(${FADE} + i - ${CLIP - START}, ${START} + i, i < ${CLIP - START});
  // Into the fade, which blends the clip's last frames with its first.
  let k = i - ${PERIOD - START};
  let fade = select(0, k / ${FADE}, k >= 0 && k < ${FADE});
  let played = 56 * i / ${PERIOD};
  let top = p - vec2f(26, 17.5);
  let bottom = p - vec2f(26, 56);
  let blend = mix(layer(clip + frame, bottom / SIZE), layer(clip + k, bottom / SIZE), fade);
  return pane(pane(vec4f(), top, layer(clip + frame, top / SIZE), played), bottom, blend, played);
}`,
} satisfies Icon;
