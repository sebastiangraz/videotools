import { ICON } from "../../client/src/tools.js";
import type { Storyboard } from "./index.js";

// The clip looped the way core/tools/loop.ts does it, starting at its middle:
// below with the crossfade, on top without, cutting hard where the fade ends.
// In frames; the loop is the clip less the fade, as its first frames only
// exist blended.
const CLIP = 3 * ICON.fps;
const FADE = ICON.fps / 2;
const START = CLIP / 2;
const PERIOD = CLIP - FADE;
const PANE = `width="56" height="31.5"`;

export default {
  duration: PERIOD / ICON.fps,
  clips: { clip: "clip-mov.mp4" },
  frame(t, { clip }, { fg }) {
    const i = Math.round(t * ICON.fps);
    const frame = i < CLIP - START ? START + i : FADE + i - (CLIP - START);
    // Into the fade, which blends the clip's last frames with its first.
    const k = i - (PERIOD - START);
    const image = (frame: number, opacity = 1) =>
      `<image ${PANE} preserveAspectRatio="xMidYMid slice" opacity="${opacity}" href="${clip[frame]}"/>`;
    // Clipped as a group, so the crossfade's layers add up at the rounded
    // corners. The line below is its playhead.
    const pane = (y: number, images: string) =>
      `<g transform="translate(26 ${y})" fill="${fg}"><g clip-path="url(#loop${i})">${images}</g>` +
      `<rect ${PANE} rx="3" fill="none" stroke="${fg}" stroke-opacity="0.16"/>` +
      `<rect y="33.5" width="56" height="1" fill-opacity="0.16"/>` +
      `<rect y="33.5" width="${(56 * i) / PERIOD}" height="1" fill-opacity="0.4"/></g>`;
    return (
      `<clipPath id="loop${i}"><rect ${PANE} rx="3"/></clipPath>` +
      pane(17.5, image(frame)) +
      pane(56, image(frame) + (k >= 0 && k < FADE ? image(k, k / FADE) : ""))
    );
  },
} satisfies Storyboard;
