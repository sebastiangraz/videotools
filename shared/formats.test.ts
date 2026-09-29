// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  FORMATS,
  FORMAT_IDS,
  SEQUENCE_FORMATS,
  STILLS,
  extensionOf,
  formatById,
  formatFromFilename,
  mimeOf,
  stillFromFilename,
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

  it("reads a still off a file name, and only a still", () => {
    expect(stillFromFilename("photo.JPEG")?.id).toBe("jpg");
    expect(stillFromFilename("photo.jpg")?.id).toBe("jpg");
    expect(stillFromFilename("logo.png")?.id).toBe("png");
    expect(stillFromFilename("anim.gif")).toBeNull();
    expect(stillFromFilename("clip.mp4")).toBeNull();
    // A result is named by its still's id, so that has to be an extension.
    for (const still of STILLS) expect(still.extensions).toContain(still.id);
  });

  it("has .webp in both tables, under one content type", () => {
    expect(stillFromFilename("photo.webp")?.id).toBe("webp");
    expect(formatFromFilename("photo.webp")?.id).toBe("webp");
    expect(mimeOf("webp")).toBe("image/webp");
  });

  it("gives a result's content type from either table", () => {
    expect(mimeOf("jpg")).toBe("image/jpeg");
    expect(mimeOf("png")).toBe("image/png");
    expect(mimeOf("mov")).toBe("video/quicktime");
  });
});
