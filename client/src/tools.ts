import { FORMATS, STILLS } from "../../shared/formats";
import { TOOL_IDS, type ToolId } from "../../shared/tools";

export type { ToolId };

// An accept list for a file input: each format's content type and its
// extensions, so a picker follows the table without a copy of it.
const acceptOf = (
  formats: readonly { mime: string; extensions: readonly string[] }[],
) =>
  formats
    .flatMap((f) => [f.mime, ...f.extensions.map((ext) => `.${ext}`)])
    .join(",");

// Every format the app writes (shared/formats.ts): animated GIF, WebP and
// AVIF are videos to ffmpeg, so every single-source tool takes them too. The list is wider
// than what the tools can hand back on purpose: video/* and the extensions
// after it let an .avi or .mkv be picked like any other file, and the app
// then says, over the title, why it has to go through convert first
// (hooks/useFormatBlocker).
const VIDEO_ACCEPT = [
  "video/*,.avi,.mkv,.wmv,.mpg,.mpeg,.3gp,.ts",
  acceptOf(FORMATS),
].join(",");

// The stills, which only the mark tool takes as well. A .webp is in both
// lists; which kind it is, only its content says.
const STILL_ACCEPT = acceptOf(STILLS);

const VIDEO_INPUT = {
  accept: VIDEO_ACCEPT,
  multiple: false,
  pickerLabel: "choose video",
};

// What each tool's tab and page show for it; the page itself (its options
// and request payload) is a component under pages/, registered in
// pages/index.ts. `description` fills the tab's preview card (keep it under
// 100 characters).
//
// Lives in its own module (not next to a component) so Vite Fast Refresh can
// hot-swap the components that import it.
const TOOL_META: Record<
  ToolId,
  {
    label: string;
    description: string;
    input: { accept: string; multiple: boolean; pickerLabel: string };
    actionLabel: string;
  }
> = {
  loop: {
    label: "Loop",
    description: "Seamlessly loop a video",
    input: VIDEO_INPUT,
    actionLabel: "Loop",
  },
  sequence: {
    label: "Sequence",
    description: "Convert images to video",
    input: { accept: "image/*", multiple: true, pickerLabel: "choose images" },
    actionLabel: "Create video",
  },
  speed: {
    label: "Speed",
    description: "Change video speed",
    input: VIDEO_INPUT,
    actionLabel: "Change speed",
  },
  convert: {
    label: "Convert",
    description: "Convert a video to another format",
    input: VIDEO_INPUT,
    actionLabel: "Convert",
  },
  mark: {
    label: "Mark",
    description: "Watermark on your video or image",
    input: {
      accept: `${VIDEO_ACCEPT},${STILL_ACCEPT}`,
      multiple: false,
      pickerLabel: "choose video or image",
    },
    actionLabel: "Mark",
  },
};

// The tools in tab order (shared/tools.ts), each with its id as `value`:
// the tabs and routes in Layout.tsx and App.tsx go by this list.
export const TOOLS = TOOL_IDS.map((value) => ({ value, ...TOOL_META[value] }));

export type Tool = (typeof TOOLS)[number];

export const toolById = (id: ToolId): Tool => ({ value: id, ...TOOL_META[id] });
