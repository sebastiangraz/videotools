import type { Icon } from "../icon";
import { ICON } from "../tools";
import grow from "./grow.avif";

// The key plays a clip under a © in glass, which fades in.
export default {
  duration: 6,
  clips: { grow },
  key: [72, 72, 42, 31.5, 15.5],
  layers(t, _, [x, y, w, h, r], frames) {
    const at: [number, number] = [x + 24.5, y + 14.5];
    return [
      {
        at: [x, y],
        size: [w, h],
        radius: r,
        z: 0,
        clip: "grow",
        frame: Math.round(t * ICON.fps) % frames.grow,
      },
      { at, size: [15, 15], radius: 15, z: 1, glass: 0.07 },
      { at, size: [7.25, 2.25], turn: 133, sweep: 272, z: 2, glass: 0.18 },
    ];
  },
} satisfies Icon;
