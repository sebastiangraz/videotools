import type { Icon } from "../icon";
import { ICON } from "../tools";
import grow from "./grow.avif";

// The Speed page's knob turning between fast and slow over a clip that plays
// at the rate it shows, dropping or repeating frames like core/tools/speed.ts.
const DURATION = 3;
const COUNT = DURATION * ICON.fps;
// Knob centre and pip ring.
const [X, Y, R] = [54, 66, 22];

// Eases between +2 and -2, lingering at each.
const speed = (t: number) => {
  const c = Math.cos((2 * Math.PI * t) / DURATION);
  return c * (3 - c * c);
};

// Source frames played by the start of each frame.
const played = [0];
for (let i = 0; i < COUNT; i++) {
  const s = speed((i + 0.5) / ICON.fps);
  played.push(played[i] + (s >= 0 ? 1 + s : 1 / (1 - s)));
}

export default {
  duration: DURATION,
  clips: { grow },
  // The clip's frame and the knob's angle.
  params(t, frames) {
    const i = Math.round(t * ICON.fps);
    // Whole loops of the clip per period, so it wraps with the icon.
    const loops = Math.max(1, Math.round(played[COUNT] / frames.grow));
    const frame = Math.round((played[i] * loops * frames.grow) / played[COUNT]) % frames.grow;
    return [frame, 45 * speed(t)];
  },
  shader: /* wgsl */ `
const PANE = vec2f(32, 18);
const R = ${R};

fn icon(p: vec2f) -> vec4f {
  let angle = u.params.y;
  let q = p - vec2f(54, 36);
  let pane = box(q, PANE, 3);
  var c = layer(grow + u.params.x, q / PANE / 2 + 0.5) * fill(pane);
  c = over(c, ink(0.16) * stroke(pane, 1));
  let k = p - vec2f(${X}, ${Y});
  c *= 1 - fill(length(k) - R - 4);
  c = over(c, ink(0.04) * fill(length(k) - R + 3));
  // The arc from the top to the pointer.
  let top = vec2f(0, -R);
  let a = degrees(atan2(k.x, -k.y));
  let swept = a >= min(0, angle) && a <= max(0, angle);
  let arc = select(min(length(k - top), length(k - turn(top, angle))), abs(length(k) - R), swept);
  c = over(c, ink(0.4) * fill(arc - 0.7));
  for (var n = 0; n < 13; n++) {
    let pip = -135 + 22.5 * f32(n);
    let on = abs(pip - angle) < 3;
    // Pips the arc has passed hide, unless the pointer is on one.
    if (!on && pip >= min(0, angle) && pip <= max(0, angle)) {
      continue;
    }
    let d = length(k - turn(top, pip));
    c *= 1 - stroke(d - 1.9, 1);
    c = over(c, ink(select(0.16, 0.4, on)) * fill(d - 0.9));
  }
  return over(c, ink(0.4) * fill(segment(turn(k, -angle), vec2f(), top + vec2f(0, 5)) - 1));
}`,
} satisfies Icon;
