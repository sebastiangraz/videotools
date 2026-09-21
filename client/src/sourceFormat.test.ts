import { describe, expect, it } from "vitest";
import { fileFormat, formatBlock, formatBlocker } from "./sourceFormat";

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
