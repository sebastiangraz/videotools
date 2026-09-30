import { FORMATS, STILLS, TOOL_IDS, type ToolId } from "../../api/_lib/formats";

export type { ToolId };

const acceptOf = (formats: readonly { mime: string; extensions: readonly string[] }[]) =>
  formats.flatMap((f) => [f.mime, ...f.extensions.map((ext) => `.${ext}`)]).join(",");

// Animated GIF/WebP/AVIF are videos to ffmpeg. Deliberately wider than what
// the tools write, so an .avi/.mkv can be picked and told to convert first.
const VIDEO_ACCEPT = ["video/*,.avi,.mkv,.wmv,.mpg,.mpeg,.3gp,.ts", acceptOf(FORMATS)].join(",");

// .webp is in both lists; only its content says which kind it is.
const STILL_ACCEPT = acceptOf(STILLS);

const VIDEO_INPUT = {
  accept: VIDEO_ACCEPT,
  multiple: false,
  pickerLabel: "choose video",
};

// `description`: tab preview card, keep under 100 characters. Kept out of
// component modules so Vite Fast Refresh can hot-swap their importers.
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
    description: "Watermark a video or image",
    input: {
      accept: `${VIDEO_ACCEPT},${STILL_ACCEPT}`,
      multiple: false,
      pickerLabel: "choose video or image",
    },
    actionLabel: "Mark",
  },
};

export const TOOLS = TOOL_IDS.map((value) => ({ value, ...TOOL_META[value] }));

export type Tool = (typeof TOOLS)[number];

export const toolById = (id: ToolId): Tool => ({ value: id, ...TOOL_META[id] });
