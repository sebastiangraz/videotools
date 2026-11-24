import type { Icon, Layer } from "../icon";
import { ICON } from "../tools";
import clip from "./clip.avif";

// The key plays a clip among formats in glass, two behind it and one in
// front, which draw out from it as the icon comes in and back as it goes.
const FORMATS = [
  { label: "MP4", at: [-24, -31.5], half: 17, z: -1 },
  { label: "WEBP", at: [-32.5, 32.25], half: 20, z: -1 },
  { label: "GIF", at: [36.25, 24.5], half: 15, z: 1 },
];

export default {
  duration: 6,
  clips: { clip },
  labels: FORMATS.map((format) => format.label),
  key: [74.5, 71.5, 35, 26, 12],
  layers(t, show, [x, y, w, h, r], frames) {
    const out = 0.8 + 0.2 * show;
    return [
      {
        at: [x, y],
        size: [w, h],
        radius: r,
        z: 0,
        clip: "clip",
        frame: Math.round(t * ICON.fps) % frames.clip,
      },
      ...FORMATS.map(({ label, at: [dx, dy], half, z }): Layer => ({
        at: [x + dx * out, y + dy * out],
        size: [half, 8],
        radius: 10.5,
        z,
        glass: 0.02,
        label,
      })),
    ];
  },
} satisfies Icon;
