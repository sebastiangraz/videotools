import { screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, it, expect, describe } from "vitest";
import { renderApp, uploadMock } from "../../test/renderApp";

describe("Loop", () => {
  // NumberField parses typed values with the runtime locale, so type the
  // locale's own decimal separator ("." in en-US, "," in sv-SE, …).
  it("accepts decimal values in number fields", async () => {
    const sep = (1.1).toLocaleString().charAt(1);
    const user = userEvent.setup();
    const file = new File(["00"], "tiny.mp4", { type: "video/mp4" });

    uploadMock.mockResolvedValue({
      url: "https://store.public.blob.vercel-storage.com/tiny-abc.mp4",
    });
    const resultUrl =
      "https://store.public.blob.vercel-storage.com/results/tiny_loop-xyz.mp4";
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (input === "/api/process" && init?.method === "POST") {
          return new Response(
            JSON.stringify({ url: resultUrl, filename: "tiny_loop.mp4" }),
            { status: 200 },
          );
        }
        if (input === resultUrl) {
          return new Response(new Blob(["video"], { type: "video/mp4" }), {
            status: 200,
          });
        }
        if (input === "/api/process" && init?.method === "DELETE") {
          return new Response(null, { status: 204 });
        }
        throw new Error(`Unexpected fetch: ${input}`);
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    await renderApp();
    await user.upload(screen.getByLabelText(/choose video/i), file);
    fireEvent.change(screen.getByLabelText(/fade duration/i), {
      target: { value: `0${sep}7` },
    });
    fireEvent.change(screen.getByLabelText(/start at/i), {
      target: { value: `1${sep}5` },
    });
    await user.click(screen.getByRole("button", { name: /^loop$/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/process",
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
    const processBody = JSON.parse(
      (fetchMock.mock.calls.find(([, init]) => init?.method === "POST")?.[1]
        ?.body as string) ?? "{}",
    );
    expect(processBody.options).toMatchObject({
      fadeDuration: 0.7,
      startSecond: 1.5,
    });
  });

  it("shows a start-frame preview card when hovering the Start at input", async () => {
    const user = userEvent.setup();
    const file = new File(["00"], "tiny.mp4", { type: "video/mp4" });
    await renderApp();
    await user.upload(screen.getByLabelText(/choose video/i), file);

    // Hidden until the user reaches for the field
    expect(
      screen.queryByLabelText(/start frame preview/i),
    ).not.toBeInTheDocument();

    // The preview lives in a Base UI PreviewCard triggered from the input
    await user.hover(screen.getByLabelText(/start at/i));
    const preview = await screen.findByLabelText(/start frame preview/i);
    expect(preview).toHaveAttribute("src", "blob:mock");
  });

  it("wheel-scrubs the preview-wrapped Start at field after picking a video", async () => {
    const user = userEvent.setup();
    const file = new File(["00"], "tiny.mp4", { type: "video/mp4" });
    await renderApp();
    await user.upload(screen.getByLabelText(/choose video/i), file);

    // Wheel scrub requires the input to be focused; one wheel tick steps by
    // `step` (0.1). The listener is a native one NumberField.Root attaches to
    // the input node, so it must survive the preview card appearing around
    // the input when a video is picked.
    const start = screen.getByLabelText(/start at/i) as HTMLInputElement;
    start.focus();
    fireEvent.wheel(start, { deltaY: -1 });
    expect(start.value).toMatch(/0[.,]1/);

    const fade = screen.getByLabelText(/fade duration/i) as HTMLInputElement;
    fade.focus();
    fireEvent.wheel(fade, { deltaY: -1 });
    expect(fade.value).toMatch(/0[.,]6/);
  });

  it("shows an error in the preview card when the browser can't decode the video", async () => {
    const user = userEvent.setup();
    const file = new File(["00"], "clip.avi", { type: "video/x-msvideo" });
    await renderApp();
    await user.upload(screen.getByLabelText(/choose video/i), file);

    await user.hover(screen.getByLabelText(/start at/i));
    const preview = await screen.findByLabelText(/start frame preview/i);
    // jsdom never decodes media; simulate the failure browsers report for
    // containers <video> can't play (AVI, WMV, …)
    fireEvent.error(preview);

    expect(
      await screen.findByText(/can.t preview this format/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText(/start frame preview/i),
    ).not.toBeInTheDocument();
  });

  it("says nothing about a file that comes back in its own format", async () => {
    const user = userEvent.setup();
    await renderApp();
    await user.upload(
      screen.getByLabelText(/choose video/i),
      new File(["00"], "anim.gif", { type: "image/gif" }),
    );

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^loop$/i })).toHaveAttribute(
      "aria-disabled",
      "false",
    );
  });

  it("sends a format the app doesn't write through convert, before any upload", async () => {
    const user = userEvent.setup();
    await renderApp();
    await user.upload(
      screen.getByLabelText(/choose video/i),
      new File(["00"], "clip.avi", { type: "video/x-msvideo" }),
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      /AVI files can be read but not written/i,
    );
    expect(
      screen.getByRole("link", { name: /convert it first/i }),
    ).toHaveAttribute("href", "/convert");

    const button = screen.getByRole("button", { name: /^loop$/i });
    expect(button).toHaveAttribute("aria-disabled", "true");
    await user.click(button);
    expect(uploadMock).not.toHaveBeenCalled();
  });
});
