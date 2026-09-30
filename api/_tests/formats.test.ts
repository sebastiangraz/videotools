import { describe, expect, it } from "vitest";
import { FORMATS, SEQUENCE_FORMATS, STILLS, formatById } from "../_lib/formats.js";

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
