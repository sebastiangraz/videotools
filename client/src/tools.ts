import { STILLS } from "../../shared/formats";

// Animated GIF and AVIF are videos to ffmpeg, and formats the app writes
// (shared/formats.ts), so every single-source tool takes them too. The list
// is wider than what the tools can hand back on purpose: an .avi is picked
// like any other file, and the app then says, over the title, why it has to
// go through convert first (hooks/useFormatBlocker).
const VIDEO_ACCEPT =
  "video/*,.avi,.mkv,.mov,.webm,.m4v,.wmv,.mpg,.mpeg,.3gp,.ts," +
  "image/gif,.gif,image/avif,.avif";

// The stills (shared/formats.ts), which only the mark tool takes as well. An
// animated .webp gets in with them and is turned away once picked.
const STILL_ACCEPT = STILLS.flatMap((still) => [
  still.mime,
  ...still.extensions.map((ext) => `.${ext}`),
]).join(",");

// Available tools. Mirrored in api/_lib/tools/index.ts (TOOLS); each tool's
// page (its options and request payload) is a component under pages/,
// registered in pages/index.ts. Also drives the routes and tab navigation
// in App.tsx, where `description` fills the tab's preview card (keep it
// under 100 characters).
//
// Lives in its own module (not next to a component) so Vite Fast Refresh can
// hot-swap the components that import it.
export const TOOLS = [
  {
    value: "loop",
    label: "Loop",
    description: "Seamlessly loop a video",
    input: {
      accept: VIDEO_ACCEPT,
      multiple: false,
      pickerLabel: "choose video",
    },
    actionLabel: "Loop",
  },
  {
    value: "sequence",
    label: "Sequence",
    description: "Convert images to video",
    input: { accept: "image/*", multiple: true, pickerLabel: "choose images" },
    actionLabel: "Create video",
  },
  {
    value: "speed",
    label: "Speed",
    description: "Change video speed",
    input: {
      accept: VIDEO_ACCEPT,
      multiple: false,
      pickerLabel: "choose video",
    },
    actionLabel: "Change speed",
  },
  {
    value: "convert",
    label: "Convert",
    description: "Convert a video to another format",
    input: {
      accept: VIDEO_ACCEPT,
      multiple: false,
      pickerLabel: "choose video",
    },
    actionLabel: "Convert",
  },
  {
    value: "mark",
    label: "Mark",
    description: "Watermark on your video or image",
    input: {
      accept: `${VIDEO_ACCEPT},${STILL_ACCEPT}`,
      multiple: false,
      pickerLabel: "choose video or image",
    },
    actionLabel: "Mark",
  },
] as const;

export type Tool = (typeof TOOLS)[number];
export type ToolId = Tool["value"];

export const toolById = (id: ToolId): Tool =>
  TOOLS.find((t) => t.value === id)!;
