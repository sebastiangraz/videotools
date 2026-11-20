import { ICON } from "../../client/src/tools.js";
import type { Storyboard } from "./index.js";

// The Speed page's knob turning between fast and slow over a clip that plays
// at the rate it shows, dropping or repeating frames like core/tools/speed.ts.
const DURATION = 3;
const COUNT = DURATION * ICON.fps;
const PANE = `x="22" y="18" width="64" height="36"`;
// Knob centre and pip ring.
const [X, Y, R] = [54, 66, 22];

// Eases between +2 and -2, lingering at each.
const speed = (t: number) => {
  const c = Math.cos((2 * Math.PI * t) / DURATION);
  return c * (3 - c * c);
};

// Source frames played by the start of each frame.
const played = [0];
for (let i = 0; i < COUNT; i++) {
  const s = speed((i + 0.5) / ICON.fps);
  played.push(played[i] + (s >= 0 ? 1 + s : 1 / (1 - s)));
}

export default {
  duration: DURATION,
  clips: { clip: "grow.mp4" },
  frame(t, { clip }, { fg, bg }) {
    const i = Math.round(t * ICON.fps);
    // Whole loops of the clip per period, so it wraps with the icon.
    const loops = Math.max(1, Math.round(played[COUNT] / clip.length));
    const frame = Math.round((played[i] * loops * clip.length) / played[COUNT]) % clip.length;
    const angle = 45 * speed(t);
    const rad = (angle * Math.PI) / 180;
    const pips = Array.from({ length: 13 }, (_, k) => {
      const a = -135 + 22.5 * k;
      const on = Math.abs(a - angle) < 3;
      // Pips the arc has passed hide, unless the pointer is on one.
      if (!on && a >= Math.min(0, angle) && a <= Math.max(0, angle)) return "";
      return `<circle cx="${X}" cy="${Y - R}" r="1.4" fill="${fg}" fill-opacity="${on ? 0.4 : 0.16}" stroke="${bg}" transform="rotate(${a} ${X} ${Y})"/>`;
    });
    return (
      `<clipPath id="speed${i}"><rect ${PANE} rx="3"/></clipPath>` +
      `<image ${PANE} preserveAspectRatio="xMidYMid slice" clip-path="url(#speed${i})" href="${clip[frame]}"/>` +
      `<rect ${PANE} rx="3" fill="none" stroke="${fg}" stroke-opacity="0.16"/>` +
      `<circle cx="${X}" cy="${Y}" r="${R + 4}" fill="${bg}"/>` +
      `<circle cx="${X}" cy="${Y}" r="${R - 3}" fill="${fg}" fill-opacity="0.04"/>` +
      `<path d="M${X} ${Y - R}A${R} ${R} 0 0 ${angle > 0 ? 1 : 0} ${X + R * Math.sin(rad)} ${Y - R * Math.cos(rad)}" fill="none" stroke="${fg}" stroke-opacity="0.4" stroke-width="1.4" stroke-linecap="round"/>` +
      pips.join("") +
      `<path d="M${X} ${Y}V${Y - R + 5}" stroke="${fg}" stroke-opacity="0.4" stroke-width="2" stroke-linecap="round" transform="rotate(${angle} ${X} ${Y})"/>`
    );
  },
} satisfies Storyboard;
