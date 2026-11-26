import { CLIPS, ICON, timeline, type Icon } from ".";

// The clip looped the way core/tools/loop.ts does it, starting at its middle:
// in the key with the crossfade, behind it without, cutting hard where the
// fade ends. In frames; the loop is the clip less the fade, as its first
// frames only exist blended.
const CLIP = CLIPS.slide;
const FADE = ICON.fps / 2;
const START = CLIP / 2;
const PERIOD = CLIP - FADE;

export default {
  duration: PERIOD / ICON.fps,
  key: [76, 86, 32, 24, 16],
  layers(t, show, key) {
    const [x, y, w, h, r] = key;
    const i = Math.round(t * ICON.fps);
    const frame = i < CLIP - START ? START + i : FADE + i - (CLIP - START);
    // Into the fade, which blends the clip's last frames with its first.
    const k = i - (PERIOD - START);
    const fade = k >= 0 && k < FADE ? k / FADE : 0;
    return [
      // Out from behind the key.
      {
        at: [x - 20 * show, y - 31 * show],
        size: [26, 19.5],
        radius: r - 2,
        z: -2,
        clip: "slide",
        frame,
      },
      {
        at: [x, y],
        size: [w, h],
        radius: r,
        z: 0,
        clip: "slide",
        frame,
        next: Math.max(k, 0),
        mix: fade,
      },
      // Along the clip rather than the loop, which starts halfway, wrapping
      // halfway through the fade.
      ...timeline(key, ((frame - FADE / 2) % PERIOD) / PERIOD),
    ];
  },
} satisfies Icon;
