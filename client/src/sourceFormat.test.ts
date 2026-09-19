import { describe, expect, it } from "vitest";
import { fileFormat, keptFormat, keptFormatBlocker } from "./sourceFormat";

const file = (name: string, type = "") => new File(["00"], name, { type });

describe("fileFormat", () => {
  it("goes by the name, then by the type the browser reports", () => {
    expect(fileFormat(file("clip.mov", "video/quicktime"))?.id).toBe("mov");
    expect(fileFormat(file("download", "image/gif"))?.id).toBe("gif");
    expect(fileFormat(file("clip.avi", "video/x-msvideo"))).toBeNull();
  });
});

describe("keptFormat", () => {
  it("hands a format of the app's back as it came", () => {
    expect(keptFormat(file("anim.gif", "image/gif"))).toMatchObject({
      state: "kept",
      format: { id: "gif" },
    });
    expect(keptFormatBlocker(file("anim.gif", "image/gif"))).toBeNull();
  });

  it("sends any other format through convert first", () => {
    expect(keptFormat(file("clip.mkv"))).toEqual({
      state: "foreign",
      name: "MKV",
    });
    expect(keptFormatBlocker(file("clip.mkv"))).toMatch(/convert/i);
  });

  it("turns animated WebP away: there is nothing to read", () => {
    expect(keptFormat(file("anim.webp", "image/webp")).state).toBe("unreadable");
    expect(keptFormatBlocker(file("anim.webp", "image/webp"))).toMatch(
      /can't be read/,
    );
  });
});
