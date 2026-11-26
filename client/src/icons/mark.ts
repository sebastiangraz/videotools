import { CLIPS, ICON, type Icon } from "../icon";

// The key plays a clip under a © in glass, which fades in.
export default {
  duration: 6,
  key: [72, 70, 35, 26, 16],
  layers(t, _, [x, y, w, h, r]) {
    const at: [number, number] = [x - 32, y + 24];
    return [
      {
        at: [x, y],
        size: [w, h],
        radius: r,
        z: 0,
        clip: "grow",
        frame: Math.round(t * ICON.fps) % CLIPS.grow,
      },
      { at, size: [20, 20], radius: 20, z: 1, glass: 0.05, flip: true },
      { at, size: [10, 3], turn: 124, sweep: 292, z: 2, glass: 0.14, flip: true },
    ];
  },
} satisfies Icon;
