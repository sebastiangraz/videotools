import { describe, expect, it } from "vitest";
import {
  fileFormat,
  formatBlock,
  formatBlocker,
  hasFrames,
  isAnimatedImage,
  isAnimatedWebp,
  isStillImage,
  stillFormat,
} from "./sourceFormat";

const file = (name: string, type = "") => new File(["00"], name, { type });

describe("fileFormat", () => {
  it("goes by the name, then by the type the browser reports", () => {
    expect(fileFormat(file("clip.mov", "video/quicktime"))?.id).toBe("mov");
    expect(fileFormat(file("download", "image/gif"))?.id).toBe("gif");
    expect(fileFormat(file("clip.avi", "video/x-msvideo"))).toBeNull();
  });
});

describe("formatBlock", () => {
  it("has nothing to say about a format of the app's", () => {
    expect(formatBlock(file("anim.gif", "image/gif"))).toBeNull();
    expect(formatBlocker(file("anim.gif", "image/gif"))).toBeNull();
  });

  it("sends any other format through convert first", () => {
    expect(formatBlock(file("clip.mkv"))).toEqual({
      state: "foreign",
      name: "MKV",
    });
    expect(formatBlocker(file("clip.mkv"))).toMatch(/convert/i);
  });

  // The tools that are asked for a format (convert, sequence): a source in
  // none of the app's is what they are for, and only a dead end stops them.
  it("lets a foreign source through where there is no format to keep", () => {
    expect(formatBlock(file("clip.mkv"), { foreign: false })).toBeNull();
    expect(formatBlocker(file("clip.mkv"), { foreign: false })).toBeNull();
    expect(
      formatBlock(file("anim.webp", "image/webp"), { foreign: false }),
    ).toMatchObject({ state: "unreadable" });
  });

  it("turns animated WebP away: there is nothing to read", () => {
    expect(formatBlock(file("anim.webp", "image/webp"))).toMatchObject({
      state: "unreadable",
      format: { id: "webp" },
    });
    expect(formatBlocker(file("anim.webp", "image/webp"))).toMatch(
      /can't be read/,
    );
  });
});

describe("stills", () => {
  it("knows a still by its name, then by its type", () => {
    expect(stillFormat(file("photo.JPG", "image/jpeg"))?.id).toBe("jpg");
    expect(stillFormat(file("download", "image/png"))?.id).toBe("png");
    expect(stillFormat(file("anim.gif", "image/gif"))).toBeNull();
    expect(stillFormat(file("clip.mp4", "video/mp4"))).toBeNull();
  });

  it("lets one through only where the tool takes stills", () => {
    const photo = file("photo.jpg", "image/jpeg");
    expect(formatBlock(photo)).toEqual({ state: "foreign", name: "JPG" });
    expect(formatBlock(photo, { stills: true })).toBeNull();
    expect(formatBlocker(photo, { stills: true })).toBeNull();
    // Taken for a still until its content says otherwise (isAnimatedWebp)
    expect(
      formatBlock(file("photo.webp", "image/webp"), { stills: true }),
    ).toBeNull();
    // What no tool takes stays out either way
    expect(formatBlock(file("clip.mkv"), { stills: true })).toMatchObject({
      state: "foreign",
    });
  });

  // "RIFF" size "WEBP", then the first chunk: VP8X carries the flags, a
  // plain lossy file starts right away with its VP8 data.
  const webp = (chunk: string, flags: number) =>
    new File(
      [
        new Uint8Array([
          ...[..."RIFF"].map((c) => c.charCodeAt(0)),
          ...[0, 0, 0, 0],
          ...[..."WEBP"].map((c) => c.charCodeAt(0)),
          ...[...chunk].map((c) => c.charCodeAt(0)),
          ...[10, 0, 0, 0],
          flags,
          ...[0, 0, 0],
        ]),
      ],
      "photo.webp",
      { type: "image/webp" },
    );

  it("tells an animated WebP from a still by its header", async () => {
    // Animation is bit 1; 0x10 is alpha, which a still may well have
    expect(await isAnimatedWebp(webp("VP8X", 0x02))).toBe(true);
    expect(await isAnimatedWebp(webp("VP8X", 0x12))).toBe(true);
    expect(await isAnimatedWebp(webp("VP8X", 0x10))).toBe(false);
    expect(await isAnimatedWebp(webp("VP8 ", 0x02))).toBe(false);
    expect(await isAnimatedWebp(file("photo.webp", "image/webp"))).toBe(false);
  });
});

describe("hasFrames", () => {
  it("tells the sources an <img> shows from the ones a <video> does", () => {
    expect(isAnimatedImage(file("anim.gif", "image/gif"))).toBe(true);
    expect(isAnimatedImage(file("anim.avif", "image/avif"))).toBe(true);
    expect(isStillImage(file("photo.jpg", "image/jpeg"))).toBe(true);
    // A .webp is a still until its content says otherwise
    expect(isStillImage(file("anim.webp", "image/webp"))).toBe(true);
    expect(isAnimatedImage(file("anim.webp", "image/webp"))).toBe(false);
    expect(isAnimatedImage(file("clip.mp4", "video/mp4"))).toBe(false);
    expect(isStillImage(file("clip.mp4", "video/mp4"))).toBe(false);
  });

  it("has frames for whatever the browser may decode, by type when unnamed", () => {
    expect(hasFrames(file("clip.mp4", "video/mp4"))).toBe(true);
    expect(hasFrames(file("clip.avi", "video/x-msvideo"))).toBe(true);
    expect(hasFrames(file("download", "image/gif"))).toBe(true);
    expect(hasFrames(file("photo.png", "image/png"))).toBe(true);
    expect(hasFrames(file("notes.txt", "text/plain"))).toBe(false);
  });
});
