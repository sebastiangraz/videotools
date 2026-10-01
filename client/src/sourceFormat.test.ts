import { describe, expect, it } from "vitest";
import {
  byFilename,
  fileFormat,
  formatBlock,
  formatBlocker,
  hasFrames,
  isAnimatedImage,
  isAnimatedWebp,
  isStillImage,
  mp4Fps,
  pickedFormats,
  stillFormat,
  targetsFor,
} from "./sourceFormat";
import { box, file, largeBox, u32, u64, webpFile } from "./test/media";

// 30 frames over 30030/30000 s: NTSC 29.97. moov trails the media data and
// lists an audio track first. v1: 64-bit mdhd times and a 64-bit mdat size.
const mp4File = (name: string, v1 = false) => {
  const zero = (n: number) => new Uint8Array(n);
  const mdhd = v1
    ? box("mdhd", new Uint8Array([1, 0, 0, 0]), zero(16), u32(30000), u64(30030))
    : box("mdhd", zero(4), zero(8), u32(30000), u32(30030));
  const stbl = box("stbl", box("stsz", zero(4), u32(0), u32(30)));
  const video = box("trak", box("mdia", mdhd, box("minf", box("vmhd"), stbl)));
  const audio = box("trak", box("mdia", box("minf", box("smhd"))));
  const mdat = (v1 ? largeBox : box)("mdat", zero(64));
  return new File([box("ftyp"), mdat, box("moov", audio, video)], name);
};

describe("mp4Fps", () => {
  it("reads the video track's average rate from a trailing moov", async () => {
    expect(await mp4Fps(mp4File("clip.mp4"))).toBeCloseTo(29.97, 2);
    expect(await mp4Fps(mp4File("clip.mov", true))).toBeCloseTo(29.97, 2);
  });

  it("is unknown without a moov or for other containers", async () => {
    expect(await mp4Fps(new File([box("ftyp"), box("mdat")], "clip.mp4"))).toBeNull();
    // A WebM's EBML magic reads as a box larger than the file.
    const ebml = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]);
    expect(await mp4Fps(new File([ebml, box("moov")], "clip.webm"))).toBeNull();
  });
});

describe("fileFormat", () => {
  it("goes by the name, then by the type the browser reports", () => {
    expect(fileFormat(file("clip.mov", "video/quicktime"))?.id).toBe("mov");
    expect(fileFormat(file("download", "image/gif"))?.id).toBe("gif");
    expect(fileFormat(file("clip.avi", "video/x-msvideo"))).toBeNull();
  });

  it("reads the last extension, whatever its case", () => {
    expect(fileFormat(file("clip.final.MOV"))?.id).toBe("mov");
    expect(fileFormat(file("clip.m4v"))?.id).toBe("mp4");
    expect(fileFormat(file("photo.webp"))?.id).toBe("webp");
    expect(fileFormat(file("clip.mkv"))).toBeNull();
    expect(fileFormat(file("noextension"))).toBeNull();
    expect(fileFormat(file("folder.mp4/clip"))).toBeNull();
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

  it("lets a foreign source through where there is no format to keep", () => {
    expect(formatBlock(file("clip.mkv"), { foreign: false })).toBeNull();
    expect(formatBlocker(file("clip.mkv"), { foreign: false })).toBeNull();
    const still = file("photo.webp", "image/webp");
    expect(formatBlock(still, { foreign: false }, true)).toBeNull();
  });

  it("takes a WebP for the format, and a still one for a still", () => {
    const webp = file("anim.webp", "image/webp");
    expect(formatBlock(webp)).toBeNull();
    expect(formatBlock(webp, {}, true)).toEqual({
      state: "foreign",
      name: "Still WebP",
    });
    expect(formatBlock(webp, { stills: true }, true)).toBeNull();
  });
});

describe("stills", () => {
  it("knows a still by its name, then by its type", () => {
    expect(stillFormat(file("photo.JPG", "image/jpeg"))?.id).toBe("jpg");
    expect(stillFormat(file("download", "image/png"))?.id).toBe("png");
    expect(stillFormat(file("anim.gif", "image/gif"))).toBeNull();
    expect(stillFormat(file("clip.mp4", "video/mp4"))).toBeNull();
    expect(stillFormat(file("photo.JPEG"))?.id).toBe("jpg");
    expect(stillFormat(file("photo.webp"))?.id).toBe("webp");
  });

  it("lets one through only where the tool takes stills", () => {
    const photo = file("photo.jpg", "image/jpeg");
    expect(formatBlock(photo)).toEqual({ state: "foreign", name: "JPG" });
    expect(formatBlock(photo, { stills: true })).toBeNull();
    expect(formatBlocker(photo, { stills: true })).toBeNull();
    expect(formatBlock(file("photo.webp", "image/webp"), { stills: true })).toBeNull();
    expect(formatBlock(file("clip.mkv"), { stills: true })).toMatchObject({
      state: "foreign",
    });
  });

  it("tells an animated WebP from a still by its header", async () => {
    // Animation is bit 1; 0x10 is alpha, which a still may well have
    expect(await isAnimatedWebp(webpFile("photo.webp", 0x02))).toBe(true);
    expect(await isAnimatedWebp(webpFile("photo.webp", 0x12))).toBe(true);
    expect(await isAnimatedWebp(webpFile("photo.webp", 0x10))).toBe(false);
    expect(await isAnimatedWebp(webpFile("photo.webp", 0x02, "VP8 "))).toBe(false);
    expect(await isAnimatedWebp(file("photo.webp", "image/webp"))).toBe(false);
  });
});

describe("hasFrames", () => {
  it("tells the sources an <img> shows from the ones a <video> does", () => {
    expect(isAnimatedImage(file("anim.gif", "image/gif"))).toBe(true);
    expect(isAnimatedImage(file("anim.avif", "image/avif"))).toBe(true);
    expect(isStillImage(file("photo.jpg", "image/jpeg"))).toBe(true);
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

describe("targetsFor", () => {
  it("offers every format but the source's own", () => {
    const all = targetsFor(null).map((t) => t.value);
    expect(all).toContain("mov");
    expect(targetsFor(file("clip.mov", "video/quicktime")).map((t) => t.value)).toEqual(
      all.filter((id) => id !== "mov"),
    );
    expect(targetsFor(file("clip.avi", "video/x-msvideo"))).toHaveLength(all.length);
  });
});

describe("pickedFormats", () => {
  it("names each format once, a still's under its own label", () => {
    const png = file("a.png", "image/png");
    expect(pickedFormats([png, file("b.PNG")])).toEqual(["PNG"]);
    expect(pickedFormats([file("c.jpg"), file("d.jpeg")])).toEqual(["JPEG"]);
    expect(pickedFormats([png, file("b.jpg"), file("c.xyz")])).toEqual(["PNG", "JPEG", "XYZ"]);
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
