import { CLIPS, type Icon, type Layer } from "../icon";
import { ICON } from "../tools";

// The key plays a clip among formats in glass, two behind it and one in
// front, which draw out from it as the icon comes in and back as it goes.
const FORMATS = [
  { label: "MP4", at: [-18, -36], half: 18, z: 1 },
  { label: "WEBP", at: [-20, 36], half: 22, z: 1 },
  { label: "GIF", at: [51, 10], half: 16, z: 1 },
];

export default {
  duration: 6,
  labels: FORMATS.map((format) => format.label),
  key: [72, 72, 35, 26, 16],
  layers(t, show, [x, y, w, h, r]) {
    const out = 0.8 + 0.2 * show;
    return [
      {
        at: [x, y],
        size: [w, h],
        radius: r,
        z: 0,
        clip: "cloud",
        frame: Math.round(t * ICON.fps) % CLIPS.cloud,
      },
      ...FORMATS.map(({ label, at: [dx, dy], half, z }): Layer => ({
        at: [x + dx * out, y + dy * out],
        size: [half, 10],
        radius: 12,
        z,
        glass: 0.02,
        label,
      })),
    ];
  },
} satisfies Icon;
