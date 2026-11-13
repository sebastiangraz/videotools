import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { it, expect, describe } from "vitest";
import { engineRun, renderApp, showCommandLine, stubEngine } from "@src/test/renderApp";
import { file } from "@src/test/media";
import { targetsFor } from "@src/sourceFormat";

const convertButton = () => screen.getByRole("button", { name: /^convert$/i });

describe("Convert", () => {
  it("requests a GIF conversion with the GIF options", async () => {
    const user = userEvent.setup();
    const video = file("clip.mov", "video/quicktime");
    stubEngine();

    await renderApp("/convert");
    expect(screen.queryByLabelText(/convert to/i)).not.toBeInTheDocument();

    await user.upload(screen.getByLabelText(/choose video/i), video);
    await user.click(screen.getByLabelText(/convert to/i));
    await user.click(await screen.findByRole("option", { name: /gif/i }));
    expect(screen.getByLabelText(/fps/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/width/i)).toBeInTheDocument();
    await user.click(convertButton());

    const { tool, files, options } = await engineRun();
    expect(tool).toBe("convert");
    expect(files[0]).toBe(video);
    // Empty fps is omitted: the tool matches the source framerate
    expect(options).toEqual({ target: "gif", quality: 100, width: 640 });
  });

  it("falls to the first other target when the source claims the default", async () => {
    const user = userEvent.setup();
    const mp4 = file("tiny.mp4", "video/mp4");
    stubEngine();

    await renderApp("/convert");
    await user.upload(screen.getByLabelText(/choose video/i), mp4);
    await user.click(convertButton());

    expect((await engineRun()).options).toEqual({
      target: targetsFor(mp4)[0].value,
      quality: 100,
    });
  });

  it("shows its settings as the CLI's command, the target left to the CLI until a file is picked and the GIF options only with GIF", async () => {
    const user = userEvent.setup();
    await renderApp("/convert");
    await showCommandLine(user);
    expect(
      screen.getByText('npx @videotools/cli CONVERT "<file|folder|glob>" --quality 100'),
    ).toBeInTheDocument();

    await user.upload(screen.getByLabelText(/choose video/i), file("tiny.mp4", "video/mp4"));
    expect(
      screen.getByText('npx @videotools/cli CONVERT "tiny.mp4" --to webm --quality 100'),
    ).toBeInTheDocument();

    await user.click(screen.getByLabelText(/convert to/i));
    await user.click(await screen.findByRole("option", { name: /gif/i }));
    expect(
      screen.getByText('npx @videotools/cli CONVERT "tiny.mp4" --to gif --quality 100 --width 640'),
    ).toBeInTheDocument();
  });

  it("accepts a format the app does not write, with no blocker and every target", async () => {
    const user = userEvent.setup();
    await renderApp("/convert");
    await user.upload(screen.getByLabelText(/choose video/i), file("clip.avi", "video/x-msvideo"));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(convertButton()).toHaveAttribute("aria-disabled", "false");
    await user.click(screen.getByLabelText(/convert to/i));
    expect(await screen.findAllByRole("option")).toHaveLength(targetsFor(null).length);
  });
});
