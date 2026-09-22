import { describe, expect, it } from "vitest";
import {
  fileFormat,
  formatBlock,
  formatBlocker,
  isAnimatedWebp,
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
    expect(formatBlock(photo, true)).toBeNull();
    expect(formatBlocker(photo, true)).toBeNull();
    // Taken for a still until its content says otherwise (isAnimatedWebp)
    expect(formatBlock(file("photo.webp", "image/webp"), true)).toBeNull();
    // What no tool takes stays out either way
    expect(formatBlock(file("clip.mkv"), true)).toMatchObject({
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
