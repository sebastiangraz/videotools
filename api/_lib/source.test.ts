// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseSourceProfile, type SourceProfile } from "./ffmpeg.js";
import { InputError } from "./errors.js";
import {
  checkSquarePixels,
  preservedFormat,
  type Source,
  sourceFormat,
  sourceStill,
} from "./source.js";

// `ffmpeg -i` summaries of real files, one per kind of source (the AVIF
// from 9.0.2, the rest from 6.1.1: 9.0 prints those lines alike).
const SUMMARIES = {
  mp4: `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'video.mp4':
  Metadata:
    major_brand     : isom
    minor_version   : 512
  Duration: 00:00:05.03, start: 0.000000, bitrate: 3050 kb/s
  Stream #0:0[0x1](eng): Video: h264 (Main) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 1600x1080, 2723 kb/s, 30 fps, 30 tbr, 30k tbn (default)
  Stream #0:1[0x2](eng): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 317 kb/s (default)`,
  // A HandBrake export with anamorphic output left on: played 1080×1080.
  anamorphic: `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'video.mp4':
  Metadata:
    major_brand     : mp42
  Duration: 00:00:10.02, start: 0.000000, bitrate: 784 kb/s
  Stream #0:0[0x1](und): Video: h264 (Main) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 1710x1080 [SAR 12:19 DAR 1:1], 778 kb/s, 60 fps, 60 tbr, 90k tbn (default)`,
  mov: `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'source.mov':
  Metadata:
    major_brand     : qt${"  "}
  Duration: 00:00:05.03, start: 0.000000, bitrate: 3050 kb/s
  Stream #0:0[0x1](eng): Video: h264 (Main) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 1600x1080, 2723 kb/s, 30 fps, 30 tbr, 30k tbn (default)
  Stream #0:1[0x2](eng): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 317 kb/s (default)`,
  // Made from an mp4, whose brand the muxer carried over in capitals.
  webm: `Input #0, matroska,webm, from 'source.webm':
  Metadata:
    COMPATIBLE_BRANDS: isomiso2avc1mp41
    MAJOR_BRAND     : isom
  Duration: 00:00:05.03, start: -0.007000, bitrate: 1334 kb/s
  Stream #0:0(eng): Video: vp9 (Profile 0), yuv420p(tv, bt709, progressive), 1600x1080, SAR 1:1 DAR 40:27, 30 fps, 30 tbr, 1k tbn (default)
  Stream #0:1(eng): Audio: opus, 48000 Hz, stereo, fltp (default)`,
  mkv: `Input #0, matroska,webm, from 'reject.mkv':
  Metadata:
    MAJOR_BRAND     : isom
  Duration: 00:00:05.03, start: 0.000000, bitrate: 2726 kb/s
  Stream #0:0(eng): Video: h264 (Main), yuv420p(tv, bt709, progressive), 1600x1080, 30 fps, 30 tbr, 1k tbn (default)`,
  gif: `Input #0, gif, from 'animation.gif':
  Duration: 00:00:02.48, start: 0.000000, bitrate: 8629 kb/s
  Stream #0:0: Video: gif, bgra, 1600x1200, 12.50 fps, 12.50 tbr, 100 tbn`,
  avif: `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'output.avif':
  Metadata:
    major_brand     : avis
  Duration: 00:00:05.03, start: 0.000000, bitrate: 494 kb/s
  Stream #0:0[0x1]: Video: av1 (libdav1d) (Main) (av01 / 0x31307661), yuv420p(tv, bt709), 800x540 [SAR 1:1 DAR 40:27], 1 fps, 1 tbr, 1 tbn (default)
  Stream #0:1[0x1](eng): Video: av1 (libdav1d) (Main) (av01 / 0x31307661), yuv420p(tv, bt709, progressive), 800x540 [SAR 1:1 DAR 40:27], 491 kb/s, 30 fps, 30 tbr, 15360 tbn (default)`,
  avi: `Input #0, avi, from 'clip.avi':
  Duration: 00:00:04.05, start: 0.000000, bitrate: 464 kb/s
  Stream #0:0: Video: mpeg4 (Simple Profile) (FMP4 / 0x34504D46), yuv420p, 320x240 [SAR 1:1 DAR 4:3], 372 kb/s, 30 fps, 30 tbr, 30 tbn
  Stream #0:1: Audio: mp3 (U[0][0][0] / 0x0055), 44100 Hz, mono, fltp, 64 kb/s`,
  "3gp": `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'clip.3gp':
  Metadata:
    major_brand     : 3gp4
  Duration: 00:00:04.00, start: 0.000000, bitrate: 351 kb/s
  Stream #0:0[0x1](und): Video: h263 (s263 / 0x33363273), yuv420p(progressive), 176x144 [SAR 12:11 DAR 4:3], 349 kb/s, SAR 1:1 DAR 11:9, 15 fps, 15 tbr, 15360 tbn (default)`,
  // A still: readable, but nothing a video tool can hand back.
  png: `Input #0, png_pipe, from 'logo.png':
  Duration: N/A, bitrate: N/A
  Stream #0:0: Video: png, rgba(pc, gbr/unknown/unknown), 300x120 [SAR 1:1 DAR 5:2], 25 fps, 25 tbr, 25 tbn`,
  // The other stills. A .jpg is read by name (image2) and given a duration.
  jpg: `Input #0, image2, from 'photo.jpg':
  Duration: 00:00:00.04, start: 0.000000, bitrate: 3054 kb/s
  Stream #0:0: Video: mjpeg (Baseline), yuvj444p(pc, bt470bg/unknown/unknown), 320x240 [SAR 1:1 DAR 4:3], 25 fps, 25 tbr, 25 tbn`,
  webp: `Input #0, webp_pipe, from 'photo.webp':
  Duration: N/A, bitrate: N/A
  Stream #0:0: Video: webp, yuv420p(tv, bt470bg/unknown/unknown), 320x240, 25 fps, 25 tbr, 25 tbn`,
  // An animated WebP has a demuxer of its own, and no duration in the
  // summary (FFmpeg.mediaInfo measures it).
  animwebp: `Input #0, webp_anim, from 'anim.webp':
  Duration: N/A, start: 0.000000, bitrate: N/A
  Stream #0:0: Video: webp_anim, argb, 160x120, 10 fps, 10 tbr, 1k tbn`,
  // Motion JPEG video: a JPEG's codec, in a container.
  mjpeg: `Input #0, avi, from 'camera.avi':
  Duration: 00:00:01.00, start: 0.000000, bitrate: 1391 kb/s
  Stream #0:0: Video: mjpeg (Baseline) (MJPG / 0x47504A4D), yuvj420p(pc, bt470bg/unknown/unknown), 320x240 [SAR 1:1 DAR 4:3], 1385 kb/s, 30 fps, 30 tbr, 30 tbn`,
  apng: `Input #0, apng, from 'anim.png':
  Duration: N/A, bitrate: N/A
  Stream #0:0: Video: apng, rgb24(pc, gbr/unknown/unknown), 300x120 [SAR 1:1 DAR 5:2], 10 fps, 10 tbr, 100k tbn`,
} as const;

const profile = (kind: keyof typeof SUMMARIES): SourceProfile => {
  const parsed = parseSourceProfile(SUMMARIES[kind]);
  if (!parsed) throw new Error(`no profile for ${kind}`);
  return parsed;
};

describe("parseSourceProfile", () => {
  it("reads what an mp4 spends, as a whole and on its video", () => {
    expect(profile("mp4")).toMatchObject({
      formatNames: ["mov", "mp4", "m4a", "3gp", "3g2", "mj2"],
      majorBrand: "isom",
      bitrateKbps: 3050,
      videoKbps: 2723,
      pixFmt: "yuv420p",
      audio: { codec: "aac", kbps: 317 },
      codec: "h264",
      width: 1600,
      height: 1080,
    });
  });

  it("has no video bitrate where ffmpeg prints none", () => {
    expect(profile("webm")).toMatchObject({
      bitrateKbps: 1334,
      videoKbps: null,
      audio: { codec: "opus", kbps: null },
    });
    expect(profile("gif")).toMatchObject({
      bitrateKbps: 8629,
      videoKbps: null,
      pixFmt: "bgra",
      audio: null,
    });
  });

  it("ignores a brand outside the mov family", () => {
    expect(profile("webm").majorBrand).toBeNull();
    expect(profile("mkv").majorBrand).toBeNull();
  });

  it("reads the CRLF lines ffmpeg prints on Windows", () => {
    const windows = SUMMARIES.mp4.replace(/\n/g, "\r\n");
    expect(parseSourceProfile(windows)).toMatchObject({
      majorBrand: "isom",
      bitrateKbps: 3050,
      videoKbps: 2723,
      audio: { codec: "aac", kbps: 317 },
    });
  });

  it("works on an AVIF's animation, not the cover image listed first", () => {
    expect(profile("avif")).toMatchObject({
      videoIndex: 1,
      fps: 30,
      videoKbps: 491,
      codec: "av1",
    });
  });

  it("skips cover art", () => {
    const covered = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'clip.mp4':
  Metadata:
    major_brand     : isom
  Duration: 00:00:05.03, start: 0.000000, bitrate: 3050 kb/s
  Stream #0:0[0x0]: Video: mjpeg (Baseline), yuvj420p(pc, bt470bg/unknown/unknown), 600x600 [SAR 1:1 DAR 1:1], 90k tbr, 90k tbn (attached pic)
  Stream #0:1[0x1](eng): Video: h264 (Main) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 1600x1080, 2723 kb/s, 30 fps, 30 tbr, 30k tbn (default)`;
    expect(parseSourceProfile(covered)).toMatchObject({
      videoIndex: 1,
      codec: "h264",
      width: 1600,
    });
  });

  it("trims QuickTime's padded brand", () => {
    expect(profile("mov").majorBrand).toBe("qt");
  });
});

describe("sourceFormat", () => {
  it.each([
    ["mp4", "mp4"],
    ["mov", "mov"],
    ["webm", "webm"],
    ["gif", "gif"],
    ["animwebp", "webp"],
    ["avif", "avif"],
  ] as const)("knows %s content as %s", (kind, format) => {
    expect(sourceFormat(profile(kind))).toBe(format);
  });

  it.each(["mkv", "avi", "3gp", "png"] as const)(
    "has no format for %s content",
    (kind) => {
      expect(sourceFormat(profile(kind))).toBeNull();
    },
  );
});

describe("sourceStill", () => {
  it.each([
    ["png", "png"],
    ["jpg", "jpg"],
    ["webp", "webp"],
  ] as const)("knows %s content as the still %s", (kind, still) => {
    expect(sourceStill(profile(kind))).toBe(still);
    expect(sourceFormat(profile(kind))).toBeNull();
  });

  it.each(["mp4", "gif", "animwebp", "mjpeg", "apng"] as const)(
    "takes %s content for no still",
    (kind) => {
      expect(sourceStill(profile(kind))).toBeNull();
    },
  );
});

describe("preservedFormat", () => {
  it("refuses a source the app cannot write back, pointing at convert", () => {
    const source = { path: "/work/input.mkv", profile: profile("mkv"), format: null, still: null };
    expect(() => preservedFormat(source)).toThrowError(InputError);
    expect(() => preservedFormat(source)).toThrowError(/MKV file.*Convert first/);
    try {
      preservedFormat(source);
    } catch (err) {
      expect((err as InputError).code).toBe("unsupported-source");
    }
  });

  it("gives back the format of one it can", () => {
    expect(
      preservedFormat({ path: "/work/input.gif", profile: profile("gif"), format: "gif", still: null }),
    ).toBe("gif");
  });
});

describe("checkSquarePixels", () => {
  const source = (kind: keyof typeof SUMMARIES): Source => {
    const p = profile(kind);
    return { path: "/work/input", profile: p, format: sourceFormat(p), still: sourceStill(p) };
  };

  it("refuses an anamorphic video, saying the size it plays at", () => {
    expect(() => checkSquarePixels(source("anamorphic"))).toThrowError(
      /stored at 1710×1080 but plays at 1080×1080/,
    );
    try {
      checkSquarePixels(source("anamorphic"));
    } catch (err) {
      expect((err as InputError).code).toBe("unsupported-source");
    }
  });

  it("goes by the container's ratio over the codec's", () => {
    expect(() => checkSquarePixels(source("3gp"))).not.toThrow();
  });

  it.each(["mp4", "webm", "gif", "avif", "png", "jpg"] as const)(
    "takes %s content with square or unset pixels",
    (kind) => {
      expect(() => checkSquarePixels(source(kind))).not.toThrow();
    },
  );

  it("leaves an animation's ratio alone: browsers show it as stored", () => {
    const gif = source("gif");
    gif.profile.sar = 12 / 19;
    expect(() => checkSquarePixels(gif)).not.toThrow();
  });
});
