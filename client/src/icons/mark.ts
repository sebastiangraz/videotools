import type { Icon } from "../icon";
import { ICON } from "../tools";
import grow from "./grow.avif";

// The key plays a clip under a © in glass, which fades in.
export default {
  duration: 6,
  clips: { grow },
  key: [72, 72, 42, 32, 18],
  layers(t, _, [x, y, w, h, r], frames) {
    const at: [number, number] = [x + 30, y + 19];
    return [
      {
        at: [x, y],
        size: [w, h],
        radius: r,
        z: 0,
        clip: "grow",
        frame: Math.round(t * ICON.fps) % frames.grow,
      },
      { at, size: [18, 18], radius: 20, z: 1, glass: 0.1 },
      { at, size: [9, 3], turn: 124, sweep: 292, z: 2, glass: 0.16 },
    ];
  },
} satisfies Icon;
