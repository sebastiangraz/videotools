// Writes the light tracker's test clips into scripts/smoke-assets/light/:
//
//   sweep.mp4  one radial gradient crossing from the left edge to the right
//   pair.mp4   two equally bright gradients wandering over the frame, meeting
//              now and then: a tracker must stay on one, not flip between them
//   accel.mp4  one gradient swinging left and right ever faster, then coming
//              to rest mid-frame: how far the smoothed point lags and settles
//   pulse.mp4  two still gradients, left (A) and right (B), changing in
//              brightness, size and colour round by round: what makes the
//              light switch sides, and what must not (ROUNDS below)
//
//   bun scripts/light-assets.mjs [<ffmpeg path>]    default: the pinned one
//
// Everything is a fixed function of time, so a rerun writes the same pictures.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import { once } from "node:events";
import path from "node:path";
import { binaryPath, root } from "./binaries.mjs";

const ffmpeg = process.argv[2] ?? binaryPath("ffmpeg");
const outDir = path.join(root, "scripts", "smoke-assets", "light");
fs.mkdirSync(outDir, { recursive: true });

const [W, H, FPS] = [640, 360, 30];
// Gradient radius (1/e² falloff) as a fraction of the height.
const RADIUS = 0.22;
const s = (RADIUS * H) / 2;
const glow = (x, y) => `exp(-(pow(X-(${x}),2)+pow(Y-(${y}),2))/${(2 * s * s).toFixed(1)})`;
const ENCODE = ["-c:v", "libx264", "-crf", "18", "-preset", "slow", "-movflags", "+faststart"];

// Each coordinate wanders between 10% and 90% of its side: two sines of
// unrelated frequencies, so the paths never repeat within a clip.
const wander = (side, [f1, p1, f2, p2]) =>
  `${side}*(0.5+0.24*sin(${f1}*T+${p1})+0.16*sin(${f2}*T+${p2}))`;

// accel: a chirp from 0.1 Hz at 0 s to 1.2 Hz at 8.5 s, starting at the left
// edge. The swing narrows from 6.5 s and is gone by 8.5 s, so the light rests
// mid-frame for the last 1.5 s. Fastest at ~6.5 s, ~2.4 frame widths/s.
const swing = "0.4*if(lt(T,6.5),1,if(lt(T,8.5),0.5+0.5*cos(PI*(T-6.5)/2),0))";
const chirp = "2*PI*(0.1*T+0.55*T*T/8.5)";

const CLIPS = {
  sweep: { seconds: 6, lum: glow(`W*T/6`, "H/2") },
  // max(), not a sum: where they overlap neither gets brighter than the other.
  pair: {
    seconds: 12,
    lum: `max(${glow(wander("W", [0.9, 0, 2.3, 1.1]), wander("H", [1.3, 2, 2.9, 0.4]))},${glow(wander("W", [1.1, 3, 2.1, 4.2]), wander("H", [0.7, 5, 3.1, 2.6]))})`,
  },
  accel: { seconds: 10, lum: glow(`W*(0.5-${swing}*cos(${chirp}))`, "H/2") },
};

for (const [name, { seconds, lum }] of Object.entries(CLIPS)) {
  const file = path.join(outDir, `${name}.mp4`);
  const { status, stderr } = spawnSync(ffmpeg, [
    "-hide_banner",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=black:s=${W}x${H}:r=${FPS}:d=${seconds},format=gray`,
    "-vf",
    `geq=lum='16+219*${lum}',format=yuv420p`,
    ...ENCODE,
    file,
  ]);
  if (status !== 0) {
    console.error(stderr.toString());
    process.exit(1);
  }
  report(file);
}

// pulse: the tracker sees luma only, so each light is set by the luma its
// middle shows (0–1, BT.601 as ffmpeg converts RGB), a colour and a radius.
// The rounds follow each other, each starting and ending with both lights at
// rest; `expect` is what the tracker should do at TRACK's defaults
// (switchMargin 0.15, holdSeconds 0.6, floor 0.6).
const BASE = 0.5;
const WHITE = [1, 1, 1];
const ORANGE = [1, 0.6, 0.25];
const BLUE = [0.3, 0.45, 1];
const PURE_BLUE = [0, 0, 1];
const REST = { luma: BASE, colour: WHITE, radius: RADIUS };
const lumaOf = ([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b;
// A light of `colour` whose brightest channel is `level`.
const paint = (colour, level = 1) => ({ colour, luma: level * lumaOf(colour) });

const ease = (v) => {
  const t = Math.min(Math.max(v, 0), 1);
  return t * t * (3 - 2 * t);
};
// 1 from `from` for `len` seconds (at half height), eased over `edge`.
const on = (u, from, len, edge = 0.06) =>
  ease((u - from) / edge + 0.5) * ease((from + len - u) / edge + 0.5);
// A square wave of `hz`, softened.
const square = (u, hz) => ease(0.5 + 4 * Math.sin(2 * Math.PI * hz * u));
const blend = (a, b, w) => ({
  luma: a.luma + ((b.luma ?? a.luma) - a.luma) * w,
  colour: a.colour.map((c, i) => c + ((b.colour ?? a.colour)[i] - c) * w),
  radius: a.radius + ((b.radius ?? a.radius) - a.radius) * w,
});
const swell = (u, hz) => Math.sin(2 * Math.PI * hz * u) * on(u, 0.5, 9, 1);

const ROUNDS = [
  {
    name: "start",
    seconds: 1.5,
    expect: "A, brighter in the first frame",
    at: (u) => ({ a: { luma: BASE * (1 + 0.1 * on(u, -1, 2)) } }),
  },
  {
    name: "under margin",
    seconds: 3,
    expect: "stays on A: B 10% brighter for 2 s, under switchMargin",
    at: (u) => ({ b: { luma: BASE * (1 + 0.1 * on(u, 0.5, 2)) } }),
  },
  {
    name: "over margin",
    seconds: 3,
    expect: "to B: 30% brighter for 2 s, once it has held for holdSeconds",
    at: (u) => ({ b: { luma: BASE * (1 + 0.3 * on(u, 0.5, 2)) } }),
  },
  {
    name: "bursts",
    seconds: 5,
    expect: "A 30% brighter for 0.2, 0.4, 0.55 and 0.8 s: to A in the last only",
    at: (u) => {
      const burst = Math.max(on(u, 0.3, 0.2), on(u, 1, 0.4), on(u, 2, 0.55), on(u, 3.2, 0.8));
      return { a: { luma: BASE * (1 + 0.3 * burst) } };
    },
  },
  {
    name: "flicker",
    seconds: 6,
    expect: "stays on A: B 35% brighter at 4 Hz, then 1 Hz (0.5 s highs)",
    at: (u) => {
      const flicker = on(u, 0.5, 2) * square(u, 4) + on(u, 3, 2.5) * square(u, 1);
      return { b: { luma: BASE * (1 + 0.35 * flicker) } };
    },
  },
  {
    name: "flash",
    seconds: 3,
    expect: "to B at once: a 0.3 s flash 1.9× as bright puts A under the floor (lost)",
    at: (u) => ({ b: { luma: BASE * (1 + 0.9 * on(u, 1, 0.3)) } }),
  },
  {
    name: "crossfade",
    seconds: 5,
    expect: "to A: rising as B dims, after A has stayed 15% ahead for holdSeconds",
    at: (u) => {
      const p = ease((u - 0.5) / 3) * (1 - ease((u - 4) / 0.8));
      return { a: { luma: BASE + 0.3 * p }, b: { luma: BASE - 0.2 * p } };
    },
  },
  {
    name: "radius",
    seconds: 6,
    expect: "B 2.5× as wide: stays on A; then A 0.55× as wide: to B (its blurred peak drops)",
    at: (u) => ({
      b: { radius: RADIUS * (1 + 1.5 * on(u, 0.4, 2.2, 0.6)) },
      a: { radius: RADIUS * (1 - 0.45 * on(u, 3.4, 2.2, 0.6)) },
    }),
  },
  {
    name: "colour",
    seconds: 7,
    expect:
      "orange A vs blue B, same channel level: to A (luma 0.54 vs 0.37); then pure blue A (0.11) vs grey B (0.3): to B at once",
    at: (u) => {
      const [first, second] = [on(u, 0.5, 2.5, 0.4), on(u, 3.8, 2.5, 0.4)];
      return {
        a: blend(blend(REST, paint(ORANGE, 0.8), first), paint(PURE_BLUE), second),
        b: blend(blend(REST, paint(BLUE, 0.8), first), { luma: 0.3 }, second),
      };
    },
  },
  {
    name: "beat",
    seconds: 10,
    expect: "A ±25% at 0.4 Hz, B at 0.65 Hz: rivals ahead for 0.4–0.8 s, some switches",
    at: (u) => ({
      a: { luma: BASE * (1 + 0.25 * swell(u, 0.4)) },
      b: { luma: BASE * (1 + 0.25 * swell(u, 0.65)) },
    }),
  },
  {
    name: "fade out",
    seconds: 4,
    expect: "B goes dark: to A at once if on B (lost); then A too: no light, the place holds",
    at: (u) => ({
      b: { luma: BASE * (1 - ease(u - 0.5)) },
      a: { luma: BASE * (1 - ease(u - 2.5)) },
    }),
  },
];

const starts = ROUNDS.reduce((acc, r) => [...acc, acc.at(-1) + r.seconds], [0]);
const LIGHTS = [
  { key: "a", x: 0.2 * W, y: H / 2 },
  { key: "b", x: 0.8 * W, y: H / 2 },
];

{
  const file = path.join(outDir, "pulse.mp4");
  const proc = spawn(
    ffmpeg,
    [
      "-hide_banner",
      "-y",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "-s",
      `${W}x${H}`,
      "-r",
      `${FPS}`,
      "-i",
      "-",
      "-vf",
      "format=yuv420p",
      ...ENCODE,
      file,
    ],
    { stdio: ["pipe", "ignore", "pipe"] },
  );
  let log = "";
  proc.stderr.on("data", (chunk) => (log += chunk));
  const closed = once(proc, "close");

  const frames = Math.round(starts.at(-1) * FPS);
  const sum = new Float32Array(W * H * 3);
  const [ex, ey] = [new Float32Array(W), new Float32Array(H)];
  for (let i = 0; i < frames; i++) {
    const time = i / FPS;
    const round = ROUNDS.findLastIndex((_, r) => starts[r] <= time);
    const set = ROUNDS[round].at(time - starts[round]);
    sum.fill(0);
    for (const { key, x, y } of LIGHTS) {
      const { luma, colour, radius } = { ...REST, ...set[key] };
      const rgb = colour.map((c) => (c * luma) / lumaOf(colour));
      if (Math.max(...rgb) > 1.001) throw new Error(`${ROUNDS[round].name}: ${key} over white`);
      // A round gaussian is a product of two 1D ones.
      const twoS2 = 2 * ((radius * H) / 2) ** 2;
      for (let px = 0; px < W; px++) ex[px] = Math.exp(-((px - x) ** 2) / twoS2);
      for (let py = 0; py < H; py++) ey[py] = Math.exp(-((py - y) ** 2) / twoS2);
      for (let py = 0, o = 0; py < H; py++) {
        for (let px = 0; px < W; px++, o += 3) {
          const g = ex[px] * ey[py];
          sum[o] += rgb[0] * g;
          sum[o + 1] += rgb[1] * g;
          sum[o + 2] += rgb[2] * g;
        }
      }
    }
    const frame = Buffer.alloc(sum.length);
    for (let o = 0; o < sum.length; o++) frame[o] = Math.round(Math.min(sum[o], 1) * 255);
    if (!proc.stdin.write(frame)) await once(proc.stdin, "drain");
  }
  proc.stdin.end();
  const [code] = await closed;
  if (code !== 0) {
    console.error(log);
    process.exit(1);
  }
  report(file);
  for (const [r, { name, expect }] of ROUNDS.entries()) {
    console.log(`  ${starts[r].toFixed(1).padStart(5)}s  ${name.padEnd(12)}  ${expect}`);
  }
}

function report(file) {
  console.log(`${path.relative(root, file)}: ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
}
