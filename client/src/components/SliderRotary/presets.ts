import type { ComponentProps } from "react";
import { RANGES } from "@videotools/core/formats";
import type { SliderRotary } from "./SliderRotary";

// Shared by every tool's quality knob.
export const QUALITY_KNOB = {
  min: RANGES.quality[0],
  max: RANGES.quality[1],
  step: 1,
  showArc: false,
  pipActiveStyle: "single",
} satisfies Partial<ComponentProps<typeof SliderRotary>>;
