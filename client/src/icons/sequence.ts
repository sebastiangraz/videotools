import type { Icon } from "../icon";
import still1 from "./still1.avif";
import still2 from "./still2.avif";
import still3 from "./still3.avif";

// Three stills drift loose on the left while the pane plays them a second each;
// a copy of the next flies over from its card and lands as its turn begins.
const DURATION = 3;
const FLIGHT = 0.6;
// Frame 0 sits this far into the first still's turn, at rest.
const LEAD = 0.2;
// A card's centre, angle and scale; the pane is a card at rest.
const PILE = [
  [31, 34, -12, 0.5],
  [38, 54, 8, 0.5],
  [30, 74, -4, 0.5],
];
const PANE = [72, 51, 0, 1];

export default {
  duration: DURATION,
  clips: { still1, still2, still3 },
  shader: /* wgsl */ `
const BOX = vec2f(18, 10.125);

fn pile(k: i32) -> vec4f {
  var poses = array(${PILE.map((pose) => `vec4f(${pose.join(", ")})`).join(", ")});
  let a = 2 * PI * (u.t / ${DURATION} + f32(k) / 3);
  return poses[k] + vec4f(2.5 * cos(a), 2.5 * sin(a), 5 * sin(2 * a), 0);
}

fn card(c: vec4f, p: vec2f, pose: vec4f, still: f32) -> vec4f {
  let q = turn(p - pose.xy, -pose.z) / pose.w;
  let d = box(q, BOX, 3) * pose.w;
  return over(over(c, layer(still, q / BOX / 2 + 0.5) * fill(d)), ink(0.16) * stroke(d, 1));
}

// The video's timeline, a segment per still.
fn bar(c: vec4f, p: vec2f, k: f32, played: f32, opacity: f32) -> vec4f {
  let w = 11 * clamp(played, 0, 1);
  let d = box(p - vec2f(54 + 12.5 * k + w / 2, 66.25), vec2f(w / 2, 0.75), 0.75);
  return over(c, ink(opacity) * fill(d) * f32(w > 0));
}

fn icon(p: vec2f) -> vec4f {
  let s = u.t + ${LEAD};
  let now = floor(s) % 3;
  let next = (now + 1) % 3;
  let flight = max(0, (fract(s) - 1 + ${FLIGHT}) / ${FLIGHT});
  var c = vec4f();
  for (var k = 0; k < 3; k++) {
    c = card(c, p, pile(k), still1 + f32(k));
  }
  c = card(c, p, vec4f(${PANE.join(", ")}), still1 + now);
  for (var k = 0; k < 3; k++) {
    c = bar(bar(c, p, f32(k), 1, 0.16), p, f32(k), s % 3 - f32(k), 0.4);
  }
  if (flight > 0) {
    let e = (1 - cos(PI * flight)) / 2;
    c = card(c, p, mix(pile(i32(next)), vec4f(${PANE.join(", ")}), e), still1 + next);
  }
  return c;
}`,
} satisfies Icon;
