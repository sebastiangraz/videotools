import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { LightPoint } from "../_lib/light-track.js";
import { MARK, watermarkGraph, watermarkLayout } from "../_lib/tools/mark-graph.js";
import {
  LIGHT,
  LightRig,
  MarkLight,
  aimLight,
  fixedRig,
  smoothLight,
} from "../_lib/tools/mark-light.js";

const FRAME = { width: 1920, height: 1080 };
const track = (points: Partial<LightPoint>[]) => ({
  ...FRAME,
  points: points.map((p, i) => ({ time: i / 10, x: 960, y: 540, strength: 1, ...p })),
});
const angles = (points: Partial<LightPoint>[], fallback = -60) =>
  aimLight(track(points), { fallback, centreAt: () => [960, 540], radius: 50 }).map((k) =>
    Math.round(k.angle),
  );

describe("aimLight", () => {
  it("aims at the light from the logo, in degrees clockwise from the top", () => {
    expect(angles([{ x: 960, y: 0 }, { x: 1900 }, { x: 960, y: 1000 }, { x: 0 }])).toEqual([
      0, 90, 180, -90,
    ]);
    expect(angles([{ x: 0, y: 0 }])).toEqual([-61]);
  });

  it("falls back to the fixed angle for a faint light, or one on the logo", () => {
    expect(angles([{ x: 1900, strength: 0 }, { x: 960 }], 30)).toEqual([30, 30]);
    // Halfway in on both counts: between the two.
    const half = angles([{ x: 960 + 50 * LIGHT.near, strength: LIGHT.minStrength / 2 }], 0)[0];
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(90);
  });

  it("measures from where a moving logo stands at each time", () => {
    const keys = aimLight(track([{ x: 960 }, { x: 960 }]), {
      fallback: 0,
      centreAt: (t) => (t < 0.05 ? [100, 540] : [1800, 540]),
      radius: 50,
    });
    expect(keys.map((k) => Math.round(k.angle))).toEqual([90, -90]);
  });
});

describe("smoothLight", () => {
  const FPS = 30;
  const turned = (keys: { angle: number }[]) =>
    keys.slice(1).map((k, i) => Math.abs(((((k.angle - keys[i].angle) % 360) + 540) % 360) - 180));
  // Keys at the tracker's rate.
  const tracked = (seconds: number, angleAt: (time: number) => number) =>
    Array.from({ length: seconds * 10 + 1 }, (_, i) => ({ time: i / 10, angle: angleAt(i / 10) }));

  it("turns a little every frame where the keys jump", () => {
    // A quarter turn at once, held: a light moving to a new spot.
    const eased = smoothLight(
      tracked(3, (t) => (t < 0.5 ? 0 : 90)),
      FPS,
    );
    expect(eased).toHaveLength(3 * FPS + 1);
    expect(eased[0].angle).toBe(0);
    const steps = turned(eased);
    const fastest = Math.max(...steps);
    // Never more than a fraction of what one lerp alone would turn at once.
    expect(fastest).toBeLessThan((90 / (LIGHT.smoothSeconds * FPS)) * 0.5);
    // Starts gently rather than at its fastest, and gets there.
    expect(steps[steps.findIndex((d) => d > 0.01)]).toBeLessThan(fastest / 4);
    expect(eased.at(-1)!.angle).toBeGreaterThan(80);
  });

  it("turns the short way round", () => {
    const eased = smoothLight(
      tracked(1, (t) => (t ? -170 : 170)),
      FPS,
    );
    for (const { angle } of eased) expect(Math.abs(angle)).toBeGreaterThan(165);
  });

  it("leaves a single key (a still) as it is", () => {
    expect(smoothLight([{ time: 0, angle: 42 }], FPS)).toEqual([{ time: 0, angle: 42 }]);
  });
});

describe("LightRig", () => {
  const keys = [0, 0, 90, 90, 180].map((angle, i) => ({ time: i / 10, angle }));

  it("leaves a still light's filters alone", () => {
    const rig = new LightRig(
      [
        { time: 0, angle: 30 },
        { time: 0.1, angle: 30.05 },
      ],
      "light.cmd",
    );
    expect(rig.moving).toBe(false);
    expect(rig.follow("crop", { x: String })).toBe("crop");
    expect(rig.perFrame("[a]", 8, 8)).toBe("[a]");
    expect(rig.perFrame("[a]negate", 8, 8)).toBe("[a]negate,");
    expect(rig.driver("[0:v]")).toEqual([]);
    expect(fixedRig(10)).toMatchObject({ angle: 10, moving: false });
  });

  it("names the filters it aims and sends only the options that change", () => {
    const rig = new LightRig(keys, "C:\\work\\light.cmd");
    expect(rig.moving).toBe(true);
    const crop = rig.follow("crop", {
      x: (a) => String(Math.round(a / 90)),
      y: () => "0",
    });
    expect(crop).toBe("crop@light0");
    expect(rig.commands()).toBe(["0.200 crop@light0 x 1;", "0.400 crop@light0 x 2;"].join("\n"));
  });

  it("repeats a still frame at the video's rate, on a clock carrying the commands", () => {
    const rig = new LightRig(keys, "C:\\work\\light.cmd");
    const chain = rig.perFrame("[a]negate", 8, 4);
    expect(chain).toContain("[a]negate[lstill0]");
    expect(chain).toContain("[lt0]scale=8:4:flags=neighbor,format=gray16le[ltick0]");
    expect(chain.endsWith("[lstill0][ltick0]blend=all_mode=normal,")).toBe(true);
    rig.perFrame("[b]", 2, 2);
    // A Windows path's colon escaped for the filter option.
    expect(rig.driver("[0:v]")).toEqual([
      "[0:v]crop=2:2,sendcmd=f='C\\:/work/light.cmd',split=2[lt0][lt1]",
    ]);
  });
});

describe("watermarkGraph with a tracked light", () => {
  const info = (width: number, height: number, codec: string) => ({
    duration: 2,
    width,
    height,
    fps: 30,
    codec,
    matrix: null,
    sar: 1,
  });
  const video = info(FRAME.width, FRAME.height, "h264");
  const logo = info(400, 400, "png");
  const { LX, LY, LW, LH } = watermarkLayout(video, logo);
  const [cx, cy] = [LX + LW / 2, LY + LH / 2];
  // The light's kernel is the one written with | (the lens's Sobels use spaces).
  const kernel = (graph: string) => /convolution(?:@light0)?=0m='([^' ]+)'/.exec(graph)?.[1];
  const light = (points: Partial<LightPoint>[], file = "light.cmd") =>
    new MarkLight(track(points), file);

  it("aims a still light once, with no clock", () => {
    // Straight above the logo: as if MARK.lightAngle were 0.
    const above = watermarkGraph(video, logo, {
      filter: "glass",
      light: light([{ x: cx, y: 0 }]),
    });
    expect(above).not.toContain("sendcmd");
    const saved = MARK.lightAngle;
    MARK.lightAngle = 0;
    try {
      expect(kernel(above)).toBe(kernel(watermarkGraph(video, logo, { filter: "glass" })));
    } finally {
      MARK.lightAngle = saved;
    }
    expect(kernel(above)).not.toBe(kernel(watermarkGraph(video, logo, { filter: "glass" })));
  });

  it("re-aims a moving light every frame from a command file it writes", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mark-light-"));
    try {
      const file = path.join(dir, "light.cmd");
      const moving = light(
        [
          { x: cx, y: 0 },
          { x: 0, y: cy },
          { x: cx, y: FRAME.height },
        ],
        file,
      );
      const graph = watermarkGraph(video, logo, { filter: "glass", light: moving });
      expect(graph).toContain("sendcmd=f=");
      expect(graph).toContain("convolution@light0=");
      // One aimed crop per ambient glow.
      for (const i of MARK.ambient.keys()) expect(graph).toContain(`crop@light${i + 1}=`);
      await moving.write();
      const lines = fs.readFileSync(file, "utf8").split("\n");
      // Eased over the frames: many small turns, from just after the start.
      expect(lines.length).toBeGreaterThan(4);
      expect(lines[0]).toMatch(/^0\.0\d\d convolution@light0 0m [-\d|]+/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("has no light to aim on the depth map or other filters", () => {
    const moving = light([
      { x: cx, y: 0 },
      { x: 0, y: cy },
    ]);
    for (const graph of [
      watermarkGraph(video, logo, { filter: "glass", view: "displacement", light: moving }),
      watermarkGraph(video, logo, { filter: "blur", light: moving }),
      watermarkGraph(video, logo, { filter: "plain", light: moving }),
    ]) {
      expect(graph).not.toContain("sendcmd");
    }
  });
});
