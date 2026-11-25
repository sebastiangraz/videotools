import { ease, mix, timeline, type Icon, type Layer } from "../icon";
import still1 from "./still1.avif";
import still2 from "./still2.avif";
import still3 from "./still3.avif";

const STILLS = ["still1", "still2", "still3"];
const DURATION = 3;

const STEP = 1;
// How far the stack has moved, eased, when the key cuts to the card dropping
// into it: on the move rather than once it settles.
const SWITCH = 0.9;

const STACK = [
  [27, -13],
  [19, -20],
  [11, -14],
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
    const cards = STACK.map((_, i): Layer => {
      const place = (i + 1 - step) * show;
      const n = Math.min(Math.max(Math.floor(place), 0), STACK.length - 1);
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
      {
        at: [x, y],
        size: [w, h],
        radius: r,
        z: 0,
        clip: STILLS[(turn + Number(step >= SWITCH)) % 3],
      },
      ...timeline(key, t / DURATION),
    ];
  },
} satisfies Icon;
