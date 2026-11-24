import { type Icon } from "../icon";
import { ICON } from "../tools";
import grow from "./grow.avif";

// The Speed page's knob turning between fast and slow beside a clip that
// plays at the rate it shows, dropping or repeating frames like
// core/tools/speed.ts.
const DURATION = 3;
const COUNT = DURATION * ICON.fps;
// The knob's centre off the key's, its radius, and its arc's.
const [X, Y, R, ARC] = [0, 28, 21.5, 28];

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
  key: [72, 64, 35, 26, 12],
  layers(t, show, key, frames) {
    const [x, y, w, h, r] = key;
    const i = Math.round(t * ICON.fps);
    // Whole loops of the clip per period, so it wraps with the icon.
    const loops = Math.max(1, Math.round(played[COUNT] / frames.grow));
    const frame = Math.round((played[i] * loops * frames.grow) / played[COUNT]) % frames.grow;
    // Swung out from the top as the icon comes in.
    const angle = 33 * speed(t) * show;
    const a = (angle * Math.PI) / 180;
    const [kx, ky] = [x + X, y + Y];
    return [
      { at: [x, y], size: [w, h], radius: r, z: -4, clip: "grow", frame },
      // ...timeline(key, played[i] / played[COUNT]),
      { at: [kx, ky], size: [ARC, 3], sweep: angle, z: 2, glass: 0.24 },
      { at: [kx, ky], size: [R, R], radius: R, z: 3, glass: 0.04 },
      {
        at: [kx + 6 * Math.sin(a), ky - 6 * Math.cos(a)],
        size: [3, 9],
        radius: 3,
        turn: angle,
        z: 3,
        glass: 0.16,
      },
    ];
  },
} satisfies Icon;
