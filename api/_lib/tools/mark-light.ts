import fs from "node:fs/promises";
import path from "node:path";
import type { FFmpeg } from "../ffmpeg.js";
import { trackLight, type LightTrack } from "../light-track.js";

// Turns the glass's light towards the brightest part of the picture: the
// tracker's point, seen from the logo, is the light angle. Over a video the
// graph's light filters are re-aimed by sendcmd as it moves, from a command
// file next to the job.
export const LIGHT = {
  // Off keeps MARK.lightAngle.
  follow: true,
  // Tracked contrast (0–1) from which the light's direction counts fully;
  // dimmer ones fade back to MARK.lightAngle (a flat or dark picture has none).
  minStrength: 0.12,
  // Logo half-diagonals from its centre within which the light's direction
  // fades back to MARK.lightAngle: a light right on the logo has none.
  near: 1.5,
  // Time constant of each of the two lerps the angle is eased by, seconds:
  // higher turns the light more calmly and further behind the picture's.
  smoothSeconds: 0.3,
};

export type LightKey = { time: number; angle: number };

const smoothstep = (x: number) => {
  const t = Math.min(Math.max(x, 0), 1);
  return t * t * (3 - 2 * t);
};

// Degrees clockwise from the top, as MARK.lightAngle, of each tracked point
// seen from the logo's centre at its time, blended back to `fallback` where
// the light is faint or on top of the logo.
export function aimLight(
  track: LightTrack,
  { fallback, centreAt, radius }: Omit<LightPlacement, "fps">,
): LightKey[] {
  const rad = (fallback * Math.PI) / 180;
  const [fx, fy] = [Math.sin(rad), -Math.cos(rad)];
  return track.points.map(({ time, x, y, strength }) => {
    const [cx, cy] = centreAt(time);
    const [dx, dy] = [x - cx, y - cy];
    const distance = Math.hypot(dx, dy);
    const w =
      distance > 0
        ? smoothstep(strength / LIGHT.minStrength) * smoothstep(distance / (LIGHT.near * radius))
        : 0;
    const [vx, vy] = [
      (w * dx) / (distance || 1) + (1 - w) * fx,
      (w * dy) / (distance || 1) + (1 - w) * fy,
    ];
    // Light straight opposite the fallback, half faded: no direction either way.
    const angle = Math.hypot(vx, vy) < 1e-6 ? fallback : (Math.atan2(vx, -vy) * 180) / Math.PI;
    return { time, angle };
  });
}

// Signed shortest turn from a to b, degrees.
const turn = (a: number, b: number) => ((((b - a) % 360) + 540) % 360) - 180;

// One key per video frame, so the light turns rather than steps at the
// tracker's rate, eased by two lerps in a row (each LIGHT.smoothSeconds):
// a change starts and settles gently, never at once. Always the short way
// round; it starts where the first key aims, so a still or the first frame
// is aimed as tracked.
export function smoothLight(keys: LightKey[], fps: number): LightKey[] {
  if (keys.length < 2 || !(fps > 0)) return keys;
  const step = 1 / fps;
  const lerp = 1 - Math.exp(-step / LIGHT.smoothSeconds);
  const [first, last] = [keys[0], keys[keys.length - 1]];
  let at = 0;
  let [eased, twice] = [first.angle, first.angle];
  const out: LightKey[] = [];
  const frames = Math.floor((last.time - first.time) / step + 1e-6) + 1;
  for (let i = 0; i < frames; i++) {
    const time = first.time + i * step;
    while (at < keys.length - 2 && keys[at + 1].time <= time) at++;
    const [a, b] = [keys[at], keys[at + 1]];
    const t = Math.min(Math.max((time - a.time) / (b.time - a.time), 0), 1);
    const target = a.angle + turn(a.angle, b.angle) * t;
    eased += turn(eased, target) * lerp;
    twice += turn(twice, eased) * lerp;
    out.push({ time, angle: ((twice + 540) % 360) - 180 });
  }
  return out;
}

export type LightPlacement = {
  fallback: number;
  centreAt: (time: number) => [number, number];
  radius: number;
  // The video's, for one key per frame.
  fps: number;
};

export const lightKeys = (track: LightTrack, placement: LightPlacement) =>
  smoothLight(aimLight(track, placement), placement.fps);

type Follow = { name: string; options: Record<string, (angle: number) => string> };

// What a graph needs to aim its light: `angle` to start at, and, when it
// moves, named filters whose options sendcmd re-sends at every key that
// changes them. Their inputs are one-frame streams (the lens is computed
// once), so `perFrame` repeats one at the video's rate for them to run on.
export class LightRig {
  readonly angle: number;
  readonly moving: boolean;
  private follows: Follow[] = [];
  private ticks: { width: number; height: number }[] = [];

  constructor(
    private keys: LightKey[],
    private file: string | null,
  ) {
    this.angle = keys[0]?.angle ?? 0;
    // Options are rounded to whole kernel taps and pixels; under a tenth of a
    // degree nothing would change.
    this.moving = file !== null && keys.some(({ angle }) => Math.abs(angle - this.angle) >= 0.1);
  }

  // `filter`'s instance name: unique when its `options` follow the light.
  follow(filter: string, options: Follow["options"]): string {
    if (!this.moving) return filter;
    const name = `${filter}@light${this.follows.length}`;
    this.follows.push({ name, options });
    return name;
  }

  // Continues `chain` (a "[label]" or a chain ending in a width×height
  // gray16le single frame) with the next filter, after repeating it once per
  // video frame when the light moves.
  perFrame(chain: string, width: number, height: number): string {
    const label = /^\[[^\]]+\]$/.test(chain);
    if (!this.moving) return label ? chain : `${chain},`;
    const n = this.ticks.length;
    this.ticks.push({ width, height });
    const still = label ? chain : `[lstill${n}]`;
    return [
      ...(label ? [] : [`${chain}${still}`]),
      `[lt${n}]scale=${width}:${height}:flags=neighbor,format=gray16le[ltick${n}]`,
      // normal at full opacity is the still frame, at the tick's time.
      `${still}[ltick${n}]blend=all_mode=normal,`,
    ].join(";");
  }

  // The video's clock for perFrame, carrying the commands. Runs the commands
  // before the frame reaches the filters they aim.
  driver(pad: string): string[] {
    if (!this.ticks.length || !this.file) return [];
    // Filter option escaping: a Windows drive's colon would end the option.
    const file = this.file.replace(/\\/g, "/").replace(/:/g, "\\:");
    const outs = this.ticks.map((_, i) => `[lt${i}]`).join("");
    return [`${pad}crop=2:2,sendcmd=f='${file}',split=${this.ticks.length}${outs}`];
  }

  // sendcmd's file: from the second key on, each option that changed.
  commands(): string {
    const last = new Map<string, string>();
    for (const { name, options } of this.follows) {
      for (const [option, value] of Object.entries(options)) {
        last.set(`${name} ${option}`, value(this.angle));
      }
    }
    const lines: string[] = [];
    for (const { time, angle } of this.keys.slice(1)) {
      const changed: string[] = [];
      for (const { name, options } of this.follows) {
        for (const [option, value] of Object.entries(options)) {
          const key = `${name} ${option}`;
          const now = value(angle);
          if (last.get(key) !== now) changed.push(`${key} ${now}`);
          last.set(key, now);
        }
      }
      if (changed.length) lines.push(`${time.toFixed(3)} ${changed.join(", ")};`);
    }
    return lines.join("\n");
  }
}

// A job's tracked light. The graph takes its rig for the logo's place;
// write() then saves that rig's commands where the graph reads them.
export class MarkLight {
  private last: LightRig | null = null;

  constructor(
    readonly track: LightTrack,
    readonly file: string,
  ) {}

  rig(placement: LightPlacement): LightRig {
    this.last = new LightRig(lightKeys(this.track, placement), this.file);
    return this.last;
  }

  async write(): Promise<void> {
    if (this.last?.moving) await fs.writeFile(this.file, this.last.commands());
  }
}

// Unaimed (LIGHT.follow off, or no graph took a rig): null.
export async function followLight(
  ff: FFmpeg,
  file: string,
  source: { width: number; height: number; videoIndex?: number },
  workDir: string,
): Promise<MarkLight | null> {
  if (!LIGHT.follow) return null;
  const track = await trackLight(ff, file, source, workDir);
  return new MarkLight(track, path.join(workDir, "light.cmd"));
}

// No tracked light: MARK.lightAngle, still.
export const fixedRig = (angle: number) => new LightRig([{ time: 0, angle }], null);
