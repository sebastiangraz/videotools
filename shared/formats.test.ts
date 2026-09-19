// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  FORMATS,
  FORMAT_IDS,
  SEQUENCE_FORMATS,
  extensionOf,
  formatById,
  formatFromFilename,
} from "./formats.js";

describe("formats", () => {
  it("lists every format once, each under extensions of its own", () => {
    expect(new Set(FORMAT_IDS).size).toBe(FORMATS.length);
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

  it("reads a format off a file name, whatever its case", () => {
    expect(formatFromFilename("clip.final.MOV")?.id).toBe("mov");
    expect(formatFromFilename("clip.m4v")?.id).toBe("mp4");
    expect(formatFromFilename("anim.gif")?.id).toBe("gif");
  });

  it("has none for what the app does not write", () => {
    expect(formatFromFilename("clip.avi")).toBeNull();
    expect(formatFromFilename("clip.mkv")).toBeNull();
    expect(formatFromFilename("noextension")).toBeNull();
    expect(extensionOf("noextension")).toBe("");
    expect(extensionOf("folder.v2/clip")).toBe("");
  });

  it("knows WebP as a format it writes but cannot read", () => {
    expect(formatById("webp").readable).toBe(false);
    expect(FORMATS.filter((f) => !f.readable).map((f) => f.id)).toEqual([
      "webp",
    ]);
  });
});
