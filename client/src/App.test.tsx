import { cleanup, render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { it, expect, describe } from "vitest";
import { ENGINE } from "@api/formats";
import readme from "../../README.md?raw";
import { EngineSetup } from "./components/EngineSetup/EngineSetup";
import { repoFile } from "./helpers";
import { engineFrom, type Engine } from "./hooks/useEngine";
import {
  downloadedName,
  enableVerboseNames,
  engineUrl,
  type FetchMock,
  postedBody,
  renderApp,
  runFinished,
  stubProcessFetch,
  uploads,
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

  it("uploads to the engine, requests processing, and downloads the result", async () => {
    const user = userEvent.setup();
    const video = mp4();
    const fetchMock = stubProcessFetch();

    await renderApp();
    await user.upload(screen.getByLabelText(/choose video/i), video);
    await user.click(loopButton());

    await runFinished();
    expect(uploads(fetchMock)).toEqual([{ id: expect.stringMatching(/\.mp4$/), file: video }]);
    expect(postedBody(fetchMock)).toMatchObject({
      upload: uploads(fetchMock)[0].id,
      tool: "loop",
      filename: "tiny.mp4",
      options: {
        technique: "crossfade",
        fadeDuration: 0.5,
        startSecond: 0,
        quality: 100,
      },
    });
    expect(downloadedName()).toBe("out.mp4");
  });

  it("names the download after the source and settings once verbose names are on", async () => {
    const user = userEvent.setup();
    stubProcessFetch();

    await renderApp();
    await enableVerboseNames(user);
    await user.upload(screen.getByLabelText(/choose video/i), mp4("holiday-clip.mp4"));
    await user.click(loopButton());

    await runFinished();
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

  it("shows an error box when processing fails, until a run succeeds", async () => {
    const user = userEvent.setup();
    const fetchMock = stubProcessFetch();
    fetchMock.mockImplementation(async (_input, init) =>
      init?.method === "PUT"
        ? new Response(null, { status: 204 })
        : Response.json({ error: "ffmpeg exited with 1" }, { status: 500 }),
    );

    await renderApp("/sequence");
    await user.upload(screen.getByLabelText(/choose images/i), file("anim.gif", "image/gif"));
    await user.click(screen.getByRole("button", { name: /create video/i }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      engineUrl("/process"),
      expect.objectContaining({
        method: "DELETE",
        body: JSON.stringify({ uploads: [uploads(fetchMock)[0].id] }),
      }),
    );

    stubProcessFetch();
    await user.click(screen.getByRole("button", { name: /create video/i }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  const hangUntilAborted = <T,>(signal?: AbortSignal | null) =>
    new Promise<T>((_, reject) => {
      signal?.addEventListener("abort", () =>
        reject(new DOMException("The operation was aborted.", "AbortError")),
      );
    });

  // A run whose /process only answers once cancelled, halfway through its
  // encode until then.
  const hangProcessing = () => {
    const fetchMock = stubProcessFetch();
    fetchMock.mockImplementation(async (input, init) => {
      if (init?.method === "POST") return hangUntilAborted<Response>(init.signal);
      const progress = typeof input === "string" && input.startsWith(engineUrl("/progress/"));
      return progress ? Response.json(0.5) : new Response(null, { status: 204 });
    });
    return fetchMock;
  };
  const postSignal = (fetchMock: FetchMock) =>
    fetchMock.mock.calls.find(([, init]) => init?.method === "POST")?.[1]?.signal;

  it("cancels a run in flight when the action button is clicked again", async () => {
    const user = userEvent.setup();
    const fetchMock = hangProcessing();

    await renderApp();
    await user.upload(screen.getByLabelText(/choose video/i), mp4());
    await user.click(loopButton());
    const button = await screen.findByRole("button", { name: /working/i });
    expect(within(button).getByText("Cancel")).toBeInTheDocument();
    expect(postSignal(fetchMock)?.aborted).toBe(false);

    await user.click(button);

    await waitFor(() => expect(loopButton()).toHaveAttribute("aria-disabled", "false"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(postSignal(fetchMock)?.aborted).toBe(true);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        engineUrl("/process"),
        expect.objectContaining({
          method: "DELETE",
          body: JSON.stringify({ uploads: [uploads(fetchMock)[0].id] }),
        }),
      ),
    );
  });

  it("keeps a run going when the action button is double-clicked", async () => {
    const user = userEvent.setup();
    const fetchMock = hangProcessing();

    await renderApp();
    await user.upload(screen.getByLabelText(/choose video/i), mp4());
    await user.dblClick(loopButton());

    expect(await screen.findByRole("button", { name: /working/i })).toBeInTheDocument();
    expect(postSignal(fetchMock)?.aborted).toBe(false);
  });

  it("shows how far a run's encode has got in the action button", async () => {
    const user = userEvent.setup();
    const fetchMock = hangProcessing();

    await renderApp();
    await user.upload(screen.getByLabelText(/choose video/i), mp4());
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();

    await user.click(loopButton());
    const button = await screen.findByRole("button", { name: /working/i });
    await waitFor(() =>
      expect(within(button).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0.5"),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      engineUrl(`/progress/${postedBody(fetchMock).job}`),
      expect.anything(),
    );
  });

  it("cancels an in-flight upload when the tool is switched", async () => {
    const user = userEvent.setup();
    const fetchMock = stubProcessFetch();
    fetchMock.mockImplementation(async (_input, init) =>
      init?.method === "PUT"
        ? hangUntilAborted<Response>(init.signal)
        : new Response(null, { status: 204 }),
    );
    const uploadSignal = () =>
      fetchMock.mock.calls.find(([, init]) => init?.method === "PUT")?.[1]?.signal;

    await renderApp();
    await user.upload(screen.getByLabelText(/choose video/i), mp4());
    await user.click(loopButton());
    expect(uploadSignal()?.aborted).toBe(false);

    // A tab change unmounts the uploader; the request must not keep running
    await user.click(screen.getByRole("tab", { name: /sequence/i }));
    await screen.findByRole("button", { name: /create video/i });
    expect(uploadSignal()?.aborted).toBe(true);
  });
});

describe("EngineSetup", () => {
  const panel = () => screen.queryByRole("region", { name: /engine setup/i });

  it.each([
    [null, /install the helper/i],
    // An engine from before the logic paths answers them without a version
    [{}, /out of date/i],
    [{ version: ENGINE.version - 0.1 }, /out of date/i],
    [{ reload: true }, /reload the page/i],
  ])("asks an engine that answered %o for what it needs", (answer, text) => {
    render(<EngineSetup engine={engineFrom(answer)} />);
    expect(panel()).toHaveTextContent(text);
  });

  it.each<Engine>([
    { state: "checking" },
    engineFrom({ version: ENGINE.version }),
    engineFrom({ version: ENGINE.version + 0.1 }),
  ])("stays away for %o", (engine) => {
    render(<EngineSetup engine={engine} />);
    expect(panel()).not.toBeInTheDocument();
  });

  // The link opens the README at the commit the site was built from, so this
  // checkout's headings are the anchors it can land on.
  it("links to a README heading", () => {
    render(<EngineSetup engine={engineFrom(null)} />);
    // GitHub's anchor for each heading
    const anchors = [...readme.matchAll(/^#+ (.+)$/gm)].map(([, heading]) =>
      heading
        .toLowerCase()
        .replace(/[^\w -]/g, "")
        .replaceAll(" ", "-"),
    );
    expect(anchors.map((anchor) => repoFile(`README.md#${anchor}`))).toContain(
      screen.getByRole("link", { name: /learn more/i }).getAttribute("href"),
    );
  });
});
