import { describe, expect, it } from "vitest";
import { FORMATS, SEQUENCE_FORMATS, STILLS, formatById, verboseName } from "../formats.js";

describe("formats", () => {
  it("lists every format once, each under extensions of its own", () => {
    expect(new Set(FORMATS.map((f) => f.id)).size).toBe(FORMATS.length);
    const extensions = FORMATS.flatMap((f) => f.extensions);
    expect(new Set(extensions).size).toBe(extensions.length);
    // A result is named by its format's id, so that has to be one of them.
    for (const format of FORMATS) {
      expect(format.extensions).toContain(format.id);
    }
  });

  it("offers the sequence tool formats that exist", () => {
    for (const id of SEQUENCE_FORMATS) expect(formatById(id).id).toBe(id);
  });

  it("names a still result by an extension of its own", () => {
    for (const still of STILLS) expect(still.extensions).toContain(still.id);
  });

  it("gives an id in both tables one content type", () => {
    for (const still of STILLS) {
      const format = FORMATS.find((f) => f.id === still.id);
      if (format) expect(format.mime).toBe(still.mime);
    }
  });
});

describe("verboseName", () => {
  it("joins the base, the extras and the options, with the result's extension", () => {
    expect(
      verboseName("holiday-clip", ["logo.png"], { filter: "glass", quality: 100 }, "mp4"),
    ).toBe("holiday-clip_logo.png_fGlass_q100.mp4");
  });

  it("tells apart bases that start alike", () => {
    expect(verboseName("clip-01", [], {}, "mp4")).not.toBe(verboseName("clip-02", [], {}, "mp4"));
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
    expect(verboseName("clip", [], options, "mp4")).toBe(`clip_${part}.mp4`);
  });

  it.each([false, null])("leaves out an option set to %s", (value) => {
    expect(verboseName("clip", [], { route: value }, "mp4")).toBe("clip.mp4");
  });
});
