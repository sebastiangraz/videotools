import { describe, expect, it } from "vitest";
import { verboseName } from "./helpers";

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
