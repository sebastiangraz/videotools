import { describe, expect, it } from "vitest";
import { byFilename, cliCommand, cx, extensionOf, splitExtension, toList } from "./helpers";
import { file } from "./test/media";

describe("cx", () => {
  it("joins the class names that are set", () => {
    expect(cx("a", false, "b", null, undefined, "")).toBe("a b");
  });
});

describe("toList", () => {
  it.each([
    [null, []],
    ["a", ["a"]],
    [
      ["a", "b"],
      ["a", "b"],
    ],
  ])("makes %o a list", (value, list) => {
    expect(toList(value)).toEqual(list);
  });
});

describe("splitExtension", () => {
  it.each([
    ["clip.final.MOV", ["clip.final", ".MOV"], "mov"],
    ["clip", ["clip", ""], ""],
    ["clip.", ["clip.", ""], ""],
  ])("splits %s", (name, parts, ext) => {
    expect(splitExtension(name)).toEqual(parts);
    expect(extensionOf(name)).toBe(ext);
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

describe("cliCommand", () => {
  const clip = [file("clip.mp4")];

  it("spells out every setting, the defaults too", () => {
    expect(
      cliCommand("mark", clip, {
        logo: "logo.svg",
        position: "bottom-right",
        size: "medium",
        filter: "glass",
        shuffle: false,
        quality: 100,
      }),
    ).toBe(
      'npx @videotools/cli MARK "clip.mp4" --logo "logo.svg" --position bottom-right --size medium --filter glass --quality 100',
    );
  });

  it("gives a switch alone and leaves out an empty field", () => {
    expect(cliCommand("mark", clip, { shuffle: true, quality: 42 })).toMatch(
      / --shuffle --quality 42$/,
    );
    expect(cliCommand("convert", clip, { to: "gif", fps: null, width: 640 })).toMatch(
      / --to gif --width 640$/,
    );
  });

  it.each([
    [-1.5, "--speed=-1.5"],
    [0, "--speed 0"],
    [3, "--speed 3"],
  ])("writes the speed %d as %s", (speed, flag) => {
    expect(cliCommand("speed", clip, { speed })).toBe(
      `npx @videotools/cli SPEED "clip.mp4" ${flag}`,
    );
  });

  it("names the files in the order given, or one to fill in", () => {
    expect(cliCommand("sequence", [file("b.png"), file("a 1.png")], {})).toBe(
      'npx @videotools/cli SEQUENCE "b.png" "a 1.png"',
    );
    expect(cliCommand("sequence", [], {})).toBe(
      'npx @videotools/cli SEQUENCE "<file|folder|glob>"',
    );
  });

  it.each([
    ["my clip.mp4", '"my clip.mp4"'],
    ["it's.mp4", `"it's.mp4"`],
    ['the "best".mp4', '"<file|folder|glob>"'],
    ["$HOME.mp4", '"<file|folder|glob>"'],
    ["`id`.mp4", '"<file|folder|glob>"'],
  ])("quotes the source %j as %s", (name, quoted) => {
    expect(cliCommand("mark", [file(name)], { logo: "logo.svg" })).toContain(
      ` MARK ${quoted} --logo `,
    );
  });

  it.each([
    ["my logo.svg", '"my logo.svg"'],
    ["$logo.png", '"<png|svg>"'],
    [undefined, '"<png|svg>"'],
  ])("quotes the logo %j as %s", (logo, quoted) => {
    expect(cliCommand("mark", clip, { logo, quality: 100 })).toContain(
      ` --logo ${quoted} --quality `,
    );
  });
});
