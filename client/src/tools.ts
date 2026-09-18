const VIDEO_ACCEPT =
  "video/*,.avi,.mkv,.mov,.webm,.m4v,.wmv,.mpg,.mpeg,.3gp,.ts";

// Available tools. Mirrored in api/process.ts (VALID_TOOLS); each tool's
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
    description: "Watermark a video with your logo",
    input: {
      // Animated GIFs are videos to ffmpeg, so they can be marked too.
      accept: `${VIDEO_ACCEPT},image/gif,.gif`,
      multiple: false,
      pickerLabel: "choose video",
    },
    actionLabel: "Mark",
  },
] as const;

export type Tool = (typeof TOOLS)[number];
export type ToolId = Tool["value"];

export const toolById = (id: ToolId): Tool =>
  TOOLS.find((t) => t.value === id)!;
