import { describe, expect, it } from "vitest";
import {
  byFilename,
  cx,
  extensionOf,
  markCommand,
  splitExtension,
  toList,
  verboseName,
} from "./helpers";
import { file } from "./test/media";

describe("cx", () => {
  it("joins the class names that are set", () => {
    expect(cx("a", false, "b", null, undefined, "")).toBe("a b");
  });
});

describe("toList", () => {
  it.each([
    [null, []],
    ["a", ["a"]],
    [
      ["a", "b"],
      ["a", "b"],
    ],
  ])("makes %o a list", (value, list) => {
    expect(toList(value)).toEqual(list);
  });
});

describe("splitExtension", () => {
  it.each([
    ["clip.final.MOV", ["clip.final", ".MOV"], "mov"],
    ["clip", ["clip", ""], ""],
    ["clip.", ["clip.", ""], ""],
  ])("splits %s", (name, parts, ext) => {
    expect(splitExtension(name)).toEqual(parts);
    expect(extensionOf(name)).toBe(ext);
  });
});

describe("byFilename", () => {
  it("sorts in natural order", () => {
    const names = ["img10.png", "b.png", "img2.png", "a.png"];
    expect(
      names
        .map((name) => file(name))
        .sort(byFilename)
        .map((f) => f.name),
    ).toEqual(["a.png", "b.png", "img2.png", "img10.png"]);
  });
});

describe("verboseName", () => {
  it("joins 6 characters of the source, the extras and the options, with the result's extension", () => {
    expect(
      verboseName("holiday-clip", ["logo.png"], { filter: "glass", quality: 100 }, "clip_mark.mp4"),
    ).toBe("holida_logo.png_fGlass_q100.mp4");
  });

  it.each([
    [{ fadeDuration: 0.5 }, "fd0.5"],
    [{ startSecond: 0 }, "ss0"],
    [{ technique: "crossfade" }, "tCrossfade"],
    [{ position: "bottom-right" }, "pBottomRight"],
    [{ shuffle: true }, "sY"],
    [{ route: ["top", "left"] }, "rY"],
    [{ tuning: { coreGain: 3 } }, "tY"],
  ])("writes %o as %s", (options, part) => {
    expect(verboseName("clip", [], options, "out.mp4")).toBe(`clip_${part}.mp4`);
  });

  it.each([false, null])("leaves out an option set to %s", (value) => {
    expect(verboseName("clip", [], { route: value }, "out.mp4")).toBe("clip.mp4");
  });
});

describe("markCommand", () => {
  const settings = {
    source: "clip.mp4",
    logo: "logo.svg",
    position: "bottom-right",
    size: "medium",
    filter: "glass",
    shuffle: false,
    quality: 100,
  } as const;

  it("spells out every setting, the defaults too", () => {
    expect(markCommand(settings)).toBe(
      'npx @videotools/cli mark "clip.mp4" --logo "logo.svg" --position bottom-right --size medium --filter glass --quality 100',
    );
  });

  it("gives each flag its setting, and --shuffle when the page would shuffle", () => {
    expect(
      markCommand({
        ...settings,
        position: "top-left",
        size: "large",
        filter: "blur",
        shuffle: true,
        quality: 42,
      }),
    ).toBe(
      'npx @videotools/cli mark "clip.mp4" --logo "logo.svg" --position top-left --size large --filter blur --shuffle --quality 42',
    );
  });

  it("asks for the tools' lowest quality where the knob turns below it", () => {
    expect(markCommand({ ...settings, quality: 0 })).toMatch(/ --quality 1$/);
  });

  it.each([
    ["my clip.mp4", '"my clip.mp4"'],
    ["it's.mp4", `"it's.mp4"`],
    ['the "best".mp4', '"<file|folder|glob>"'],
    ["$HOME.mp4", '"<file|folder|glob>"'],
    ["`id`.mp4", '"<file|folder|glob>"'],
    [undefined, '"<file|folder|glob>"'],
  ])("quotes the source %j as %s", (source, quoted) => {
    expect(markCommand({ ...settings, source })).toContain(` mark ${quoted} --logo `);
  });

  it.each([
    ["my logo.svg", '"my logo.svg"'],
    ["$logo.png", '"<png|svg>"'],
    [undefined, '"<png|svg>"'],
  ])("quotes the logo %j as %s", (logo, quoted) => {
    expect(markCommand({ ...settings, logo })).toContain(` --logo ${quoted} --position `);
  });
});
