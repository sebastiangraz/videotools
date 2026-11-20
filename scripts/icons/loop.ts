import { ICON } from "../../client/src/tools.js";
import type { Storyboard } from "./index.js";

// The clip's first PERIOD + FADE frames looped twice: on top with a hard cut,
// below crossfaded the way core/tools/loop.ts does it, starting at FADE.
const DURATION = 3;
const PERIOD = DURATION * ICON.fps;
const FADE = ICON.fps / 2;
const PANE = `width="56" height="31.5"`;

export default {
  duration: DURATION,
  clips: { clip: "clip-mov.mp4" },
  frame(t, { clip }, { fg }) {
    // Half a period in, so the still at t=0 is mid-play rather than the cut.
    const i = (Math.round(t * ICON.fps) + PERIOD / 2) % PERIOD;
    const k = i - (PERIOD - FADE);
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
      pane(17.5, image(FADE + i)) +
      pane(56, k < 0 ? image(FADE + i) : image(PERIOD + k) + image(k, k / FADE))
    );
  },
} satisfies Storyboard;
