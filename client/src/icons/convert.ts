import { CLIPS, ICON, type Icon, type Layer } from "../icon";

// The key plays a clip among formats in glass, in front of it, which draw out
// from it as the icon comes in and back as it goes.
const FORMATS = [
  { label: "MP4", at: [-18, -36], half: 18 },
  { label: "WEBP", at: [-36, 24], half: 22 },
  { label: "GIF", at: [31, 36], half: 16 },
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
      ...FORMATS.map(({ label, at: [dx, dy], half }): Layer => ({
        at: [x + dx * out, y + dy * out],
        size: [half, 10],
        radius: 12,
        z: 1,
        glass: 0.035,
        flip: true,
        label,
      })),
    ];
  },
} satisfies Icon;
