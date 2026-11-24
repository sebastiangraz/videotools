import { ease, mix, timeline, type Icon, type Layer } from "../icon";
import still1 from "./still1.avif";
import still2 from "./still2.avif";
import still3 from "./still3.avif";

// The key plays three stills a second each, the ones to come stacked behind
// it: as a turn ends, the front card drops into the key, the rest move up and
// the still it shows rises again at the back.
const STILLS = ["still1", "still2", "still3"];
const DURATION = 3;
// Seconds the stack takes to move, ending as the turn does.
const STEP = 0.4;
// A card's half width and top above the key's in each place, after the key's
// own: three on show, then one out of sight behind them.
const STACK = [
  [27, -8],
  [19.5, -14],
  [13, -18],
  [7, -14],
];

export default {
  duration: DURATION,
  clips: { still1, still2, still3 },
  key: [72, 81, 35, 26, 16],
  layers(t, show, key) {
    const [x, y, w, h, r] = key;
    const turn = Math.floor(t);
    const step = ease(Math.max(0, (t - turn - 1 + STEP) / STEP));
    const places = [[w, 0], ...STACK];
    // Out from behind the key as the icon comes in.
    const cards = [0, 1, 2, 3].map((i): Layer => {
      const place = (i + 1 - step) * show;
      const n = Math.min(Math.floor(place), 3);
      const [half, top] = mix(places[n], places[n + 1], place - n);
      return {
        at: [x, y - h + top + 0.75 * half],
        size: [half, 0.75 * half],
        radius: (r * half) / w,
        z: -1 - place,
        clip: STILLS[(turn + 1 + i) % 3],
      };
    });
    return [
      ...cards,
      { at: [x, y], size: [w, h], radius: r, z: 0, clip: STILLS[turn % 3] },
      ...timeline(key, t / DURATION),
    ];
  },
} satisfies Icon;
