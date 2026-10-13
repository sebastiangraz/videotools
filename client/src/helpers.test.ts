import { describe, expect, it } from "vitest";
import { byFilename, cx, extensionOf, splitExtension, toList, verboseName } from "./helpers";
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
  ])("writes %o as %s", (options, part) => {
    expect(verboseName("clip", [], options, "out.mp4")).toBe(`clip_${part}.mp4`);
  });

  it.each([false, null])("leaves out an option set to %s", (value) => {
    expect(verboseName("clip", [], { route: value }, "out.mp4")).toBe("clip.mp4");
  });
});
