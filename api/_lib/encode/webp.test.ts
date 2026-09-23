// @vitest-environment node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Source } from "../source.js";
import { isLosslessSource, isLosslessWebp } from "./webp.js";

const bytes = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0));
const join = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  parts.reduce((at, p) => (out.set(p, at), at + p.length), 0);
  return out;
};

// A chunk: fourcc, little-endian size, data padded to an even length.
const chunk = (tag: string, size: number, data = new Uint8Array(size)) => {
  const header = join(bytes(tag), new Uint8Array(4));
  new DataView(header.buffer).setUint32(4, data.length, true);
  return join(header, data, new Uint8Array(data.length % 2));
};

// An ANMF frame: the 16-byte frame header, then the frame's own chunks.
const frame = (...chunks: Uint8Array[]) =>
  chunk("ANMF", 0, join(new Uint8Array(16), ...chunks));

const picture = (tag: "VP8 " | "VP8L") => chunk(tag, 5);

const webp = (...chunks: Uint8Array[]) =>
  join(bytes("RIFF\0\0\0\0WEBP"), chunk("VP8X", 10), chunk("ANIM", 6), ...chunks);

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "webp-test-"));
afterAll(() => fs.rm(dir, { recursive: true, force: true }));

const lossless = async (name: string, content: Uint8Array) => {
  const file = path.join(dir, name);
  await fs.writeFile(file, content);
  return isLosslessWebp(file);
};

describe("isLosslessWebp", () => {
  it("goes by the pictures of every frame", async () => {
    const vp8l = frame(picture("VP8L"));
    const vp8 = frame(picture("VP8 "));
    expect(await lossless("lossless.webp", webp(vp8l, vp8l))).toBe(true);
    expect(await lossless("lossy.webp", webp(vp8, vp8))).toBe(false);
    // gif2webp -mixed: lossless where it pays, lossy elsewhere
    expect(await lossless("mixed.webp", webp(vp8l, vp8))).toBe(false);
  });

  it("steps over what comes before a picture", async () => {
    // An odd-sized ICC profile (padded), and a lossy frame's alpha
    const icc = chunk("ICCP", 301);
    const alpha = chunk("ALPH", 7);
    expect(await lossless("icc.webp", webp(icc, frame(picture("VP8L"))))).toBe(true);
    expect(await lossless("alpha.webp", webp(frame(alpha, picture("VP8 "))))).toBe(false);
  });

  it("takes a file with no picture for lossy", async () => {
    expect(await lossless("empty.webp", webp())).toBe(false);
  });
});

// Only what isLosslessSource reads of a source.
const source = (
  format: Source["format"],
  codec: string,
  pixFmt: string,
  file = "",
) => ({ path: file, format, profile: { codec, pixFmt } }) as Source;

describe("isLosslessSource", () => {
  it("takes pictures with no source for lossless", async () => {
    expect(await isLosslessSource(null)).toBe(true);
  });

  it("refuses the lossy video codecs", async () => {
    expect(await isLosslessSource(source("avif", "av1", "yuv420p"))).toBe(false);
    expect(await isLosslessSource(source("mp4", "h264", "yuv420p"))).toBe(false);
    expect(await isLosslessSource(source("webm", "vp9", "yuv444p"))).toBe(false);
  });

  it("takes a lossless codec, or a lossy one in its RGB mode", async () => {
    expect(await isLosslessSource(source("gif", "gif", "bgra"))).toBe(true);
    expect(await isLosslessSource(source(null, "ffv1", "yuv420p"))).toBe(true);
    // AVIF saved lossless (encode/avif.ts)
    expect(await isLosslessSource(source("avif", "av1", "gbrp"))).toBe(true);
  });

  it("goes by the file for a WebP", async () => {
    const vp8l = path.join(dir, "source-lossless.webp");
    const vp8 = path.join(dir, "source-lossy.webp");
    await fs.writeFile(vp8l, webp(frame(picture("VP8L"))));
    await fs.writeFile(vp8, webp(frame(picture("VP8 "))));
    // ffmpeg decodes both to argb, so the probe can't tell
    expect(await isLosslessSource(source("webp", "webp", "argb", vp8l))).toBe(true);
    expect(await isLosslessSource(source("webp", "webp", "argb", vp8))).toBe(false);
  });
});
