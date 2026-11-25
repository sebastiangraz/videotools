import { CLIPS, type Icon } from "../icon";
import { ICON } from "../tools";

// The key plays a clip under a © in glass, which fades in.
export default {
  duration: 6,
  key: [76, 76, 40, 30, 16],
  layers(t, _, [x, y, w, h, r]) {
    const at: [number, number] = [x + 45, y + 10];
    return [
      {
        at: [x, y],
        size: [w, h],
        radius: r,
        z: 0,
        clip: "grow",
        frame: Math.round(t * ICON.fps) % CLIPS.grow,
      },
      { at, size: [20, 20], radius: 20, z: 1, glass: 0.05 },
      { at, size: [10, 3], turn: 124, sweep: 292, z: 2, glass: 0.14 },
    ];
  },
} satisfies Icon;
