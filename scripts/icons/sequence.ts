import { ICON } from "../../client/src/tools.js";
import type { Storyboard } from "./index.js";

// Three stills drift loose on the left while the pane plays them a second each;
// a copy of the next flies over from its card and lands as its turn begins.
const DURATION = 3;
const FLIGHT = 0.6;
// Frame 0 sits this far into the first still's turn, at rest.
const LEAD = 0.2;
// A card's centre, angle and scale; the pane is a card at rest.
const PILE = [
  [31, 34, -12, 0.5],
  [38, 54, 8, 0.5],
  [30, 74, -4, 0.5],
];
const PANE = [72, 51, 0, 1];
const BOX = `x="-18" y="-10.125" width="36" height="20.25" rx="3"`;

export default {
  duration: DURATION,
  clips: { still1: "still1.png", still2: "still2.png", still3: "still3.png" },
  frame(t, { still1, still2, still3 }, { fg }) {
    const i = Math.round(t * ICON.fps);
    const stills = [still1[0], still2[0], still3[0]];
    const card = ([x, y, angle, scale]: number[], href: string) =>
      `<g transform="translate(${x} ${y}) rotate(${angle}) scale(${scale})">` +
      `<image ${BOX} preserveAspectRatio="xMidYMid slice" clip-path="url(#card${i})" href="${href}"/>` +
      `<rect ${BOX} fill="none" stroke="${fg}" stroke-opacity="0.16" stroke-width="${1 / scale}"/></g>`;
    const pile = PILE.map(([x, y, angle, scale], k) => {
      const a = 2 * Math.PI * (t / DURATION + k / 3);
      return [x + 2.5 * Math.cos(a), y + 2.5 * Math.sin(a), angle + 5 * Math.sin(2 * a), scale];
    });
    const s = t + LEAD;
    const now = Math.floor(s) % 3;
    const next = (now + 1) % 3;
    const flight = Math.max(0, ((s % 1) - 1 + FLIGHT) / FLIGHT);
    const e = (1 - Math.cos(Math.PI * flight)) / 2;
    const flyer = pile[next].map((v, j) => v + (PANE[j] - v) * e);
    // The video's timeline, a segment per still.
    const bar = (k: number, played: number, opacity: number) =>
      `<rect x="${54 + 12.5 * k}" y="65.5" width="${11 * Math.min(1, Math.max(0, played))}" height="1.5" rx="0.75" fill="${fg}" fill-opacity="${opacity}"/>`;
    return (
      `<clipPath id="card${i}"><rect ${BOX}/></clipPath>` +
      pile.map((pose, k) => card(pose, stills[k])).join("") +
      card(PANE, stills[now]) +
      [0, 1, 2].map((k) => bar(k, 1, 0.16) + bar(k, (s % 3) - k, 0.4)).join("") +
      (flight ? card(flyer, stills[next]) : "")
    );
  },
} satisfies Storyboard;
