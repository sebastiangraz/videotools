import type { ComponentProps } from "react";
import type { SliderRotary } from "./SliderRotary";

// Shared by every tool's quality knob.
export const QUALITY_KNOB = { min: 0, max: 100, step: 1, showArc: false } satisfies Partial<
  ComponentProps<typeof SliderRotary>
>;
