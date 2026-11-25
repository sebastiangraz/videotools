import { CLIPS, ease, type Icon } from "../icon";
import { ICON } from "../tools";

// The Speed page's knob turning between fast and slow beside a clip that
// plays at the rate it shows, dropping or repeating frames like
// core/tools/speed.ts.
const DURATION = 3;
const COUNT = DURATION * ICON.fps;
// The knob's centre off the key's, its radius, and its arc's.
const [X, Y, R, ARC] = [0, 28, 21.5, 28];

// Eases from +2 to -2 and back.
const speed = (t: number) => 2 - 4 * ease(1 - Math.abs(1 - (2 * t) / DURATION));

// Source frames played by the start of each frame.
const played = [0];
for (let i = 0; i < COUNT; i++) {
  const s = speed((i + 0.5) / ICON.fps);
  played.push(played[i] + (s >= 0 ? 1 + s : 1 / (1 - s)));
}
// Whole loops of the clip per period, so it wraps with the icon.
const LOOPS = Math.max(1, Math.round(played[COUNT] / CLIPS.sky));

export default {
  duration: DURATION,
  cloud: {
    lobes: 3,
    lobeScale: 3,
    lobeHeight: 0.3,
    lobeBlend: 0.15,
    lobeRadius: 0.4,
    lobeSpread: 0.09,
    lobeSwell: 0.22,
    lobeDrift: 0.17,

    smoothing: 0.05,

    base: 0.5,
    edge: 0.08,
    scale: 1.8,
    clusters: 2,
    clusterCoverage: 2,
    clusterSpacing: -0.3,
    clusterScatter: 0.8,
    clusterSpread: 0.6,
    clusterSwell: 0.3,
    clusterRows: 2,
    clusterY: -0.5,
    clusterWidth: 1.3,
    clusterHeight: 0.9,
    clusterStretch: 0.72,
    density: 7,
  },
  key: [72, 64, 35, 26, 16],
  layers(t, show, key) {
    const [x, y, w, h, r] = key;
    const i = Math.round(t * ICON.fps);
    const frame = Math.round((played[i] * LOOPS * CLIPS.sky) / played[COUNT]) % CLIPS.sky;
    // Swung out from the top as the icon comes in.
    const angle = 33 * speed(t) * show;
    const a = (angle * Math.PI) / 180;
    const [kx, ky] = [x + X, y + Y];
    return [
      { at: [x, y], size: [w, h], radius: r, z: 0, clip: "sky", frame },
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
