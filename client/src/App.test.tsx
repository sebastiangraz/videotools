import { act, cleanup, screen, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, it, expect, describe } from "vitest";
import { runEngine } from "@src/engine";
import {
  downloadedName,
  enableVerboseNames,
  engineRun,
  renderApp,
  stubEngine,
} from "./test/renderApp";
import { file } from "./test/media";

const mp4 = (name = "tiny.mp4") => file(name, "video/mp4");
const loopButton = () => screen.getByRole("button", { name: /^loop$/i });

describe("App", () => {
  // aria-disabled rather than disabled, so a tooltip can explain it on hover
  it("explains the disabled button in a tooltip, until a file is picked", async () => {
    const user = userEvent.setup();
    await renderApp();
    expect(loopButton()).toHaveAttribute("aria-disabled", "true");

    await user.hover(loopButton());
    await waitFor(() => expect(loopButton()).toHaveAttribute("data-popup-open"));

    await user.unhover(loopButton());
    await user.upload(screen.getByLabelText(/choose video/i), mp4());
    expect(loopButton()).toHaveAttribute("aria-disabled", "false");

    await user.hover(loopButton());
    await waitFor(() => expect(loopButton()).not.toHaveAttribute("data-popup-open"));
  });

  const getUpload = (pickerLabel: RegExp) => screen.getByLabelText(pickerLabel).closest("label")!;

  it("accepts a dropped file and enables the button", async () => {
    await renderApp();

    fireEvent.drop(getUpload(/choose video/i), {
      dataTransfer: { files: [mp4("dropped.mp4")] },
    });

    expect(screen.getByText("dropped.mp4")).toBeInTheDocument();
    expect(loopButton()).toHaveAttribute("aria-disabled", "false");
  });

  it("ignores dropped files that don't match the tool's accept list", async () => {
    await renderApp();

    fireEvent.drop(getUpload(/choose video/i), {
      dataTransfer: { files: [file("photo.png", "image/png")] },
    });

    expect(screen.queryByText("photo.png")).not.toBeInTheDocument();
    expect(loopButton()).toHaveAttribute("aria-disabled", "true");
  });

  it("keeps only the first dropped file on single-file tools", async () => {
    await renderApp();

    fireEvent.drop(getUpload(/choose video/i), {
      dataTransfer: { files: [mp4("first.mp4"), mp4("second.mp4")] },
    });

    expect(screen.getByText("first.mp4")).toBeInTheDocument();
    expect(screen.queryByText(/2 files/i)).not.toBeInTheDocument();
  });

  it("accepts multiple dropped images on the sequence tool", async () => {
    await renderApp("/sequence");

    fireEvent.drop(getUpload(/choose images/i), {
      dataTransfer: {
        files: [file("a.png", "image/png"), file("b.png", "image/png")],
      },
    });

    expect(screen.getByText(/2 files/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create video/i })).toHaveAttribute(
      "aria-disabled",
      "false",
    );
  });

  it("switches tool and clears the picked file when a tab is clicked", async () => {
    const user = userEvent.setup();
    const router = await renderApp();

    await user.upload(screen.getByLabelText(/choose video/i), mp4());
    expect(loopButton()).toHaveAttribute("aria-disabled", "false");

    await user.click(screen.getByRole("tab", { name: /sequence/i }));
    expect(await screen.findByRole("button", { name: /create video/i })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(router.state.location.pathname).toBe("/sequence");
  });

  it.each(["/", "/does-not-exist"])("redirects %s to /loop", async (path) => {
    const router = await renderApp(path);
    expect(router.state.location.pathname).toBe("/loop");
  });

  it("runs the tool on the picked file and saves the result under the engine's name", async () => {
    const user = userEvent.setup();
    const video = mp4();
    stubEngine();

    await renderApp();
    await user.upload(screen.getByLabelText(/choose video/i), video);
    await user.click(loopButton());

    const { tool, files, options } = await engineRun();
    expect(tool).toBe("loop");
    expect(files).toHaveLength(1);
    expect(files[0]).toBe(video);
    expect(options).toEqual({
      technique: "crossfade",
      fadeDuration: 0.5,
      startSecond: 0,
      quality: 100,
    });
    expect(downloadedName()).toBe("out.mp4");
  });

  it("names the download after the source and settings once verbose names are on", async () => {
    const user = userEvent.setup();
    stubEngine();

    await renderApp();
    await enableVerboseNames(user);
    await user.upload(screen.getByLabelText(/choose video/i), mp4("holiday-clip.mp4"));
    await user.click(loopButton());

    await engineRun();
    expect(downloadedName()).toBe("holida_tCrossfade_fd0.5_ss0_q100.mp4");
  });

  it("remembers settings across reloads", async () => {
    const user = userEvent.setup();
    await renderApp();
    await enableVerboseNames(user);
    cleanup();

    await renderApp();
    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(await screen.findByRole("button", { name: "Enabled" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("shows an error box when a run fails, until one succeeds", async () => {
    const user = userEvent.setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(runEngine).mockRejectedValue(new Error("Processing failed"));

    await renderApp("/sequence");
    await user.upload(screen.getByLabelText(/choose images/i), file("anim.gif", "image/gif"));
    await user.click(screen.getByRole("button", { name: /create video/i }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();

    stubEngine();
    await user.click(screen.getByRole("button", { name: /create video/i }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  // A run that only ends when cancelled; hands back its signal.
  const hangEngine = () => {
    vi.mocked(runEngine).mockImplementation(
      (_, signal) =>
        new Promise((_, reject) => signal!.addEventListener("abort", () => reject(signal!.reason))),
    );
    return () => vi.mocked(runEngine).mock.calls[0][1]!;
  };

  it("cancels a run in flight when the action button is clicked again", async () => {
    const user = userEvent.setup();
    const signal = hangEngine();

    await renderApp();
    await user.upload(screen.getByLabelText(/choose video/i), mp4());
    await user.click(loopButton());
    const button = screen.getByRole("button", { name: /processing/i });
    expect(within(button).getByText("Cancel")).toBeInTheDocument();
    expect(signal().aborted).toBe(false);

    await user.click(button);

    await waitFor(() => expect(loopButton()).toHaveAttribute("aria-disabled", "false"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(signal().aborted).toBe(true);
  });

  it("keeps a run going when the action button is double-clicked", async () => {
    const user = userEvent.setup();
    const signal = hangEngine();

    await renderApp();
    await user.upload(screen.getByLabelText(/choose video/i), mp4());
    await user.dblClick(loopButton());

    expect(screen.getByRole("button", { name: /processing/i })).toBeInTheDocument();
    expect(signal().aborted).toBe(false);
  });

  it("starts one run for two clicks that come before a re-render", async () => {
    const user = userEvent.setup();
    hangEngine();

    await renderApp();
    await user.upload(screen.getByLabelText(/choose video/i), mp4());
    // One act: React renders once both are in
    act(() => {
      loopButton().click();
      loopButton().click();
    });

    expect(runEngine).toHaveBeenCalledOnce();
  });

  it("shows how far a run has got in the action button while it's in flight", async () => {
    const user = userEvent.setup();
    hangEngine();

    await renderApp();
    await user.upload(screen.getByLabelText(/choose video/i), mp4());
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();

    await user.click(loopButton());
    act(() => vi.mocked(runEngine).mock.calls[0][2]!(0.5));
    const button = screen.getByRole("button", { name: /processing/i });
    expect(within(button).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0.5");
  });

  it("cancels an in-flight run when the tool is switched", async () => {
    const user = userEvent.setup();
    const signal = hangEngine();

    await renderApp();
    await user.upload(screen.getByLabelText(/choose video/i), mp4());
    await user.click(loopButton());
    expect(signal().aborted).toBe(false);

    // A tab change unmounts the page; its run must not keep going
    await user.click(screen.getByRole("tab", { name: /sequence/i }));
    await screen.findByRole("button", { name: /create video/i });
    expect(signal().aborted).toBe(true);
  });
});
