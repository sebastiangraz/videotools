import { CSSProperties, ReactNode } from "react";
import { Slider as BaseSlider } from "@base-ui/react/slider";
import styles from "./Slider.module.css";

// Centre-anchored fill for a signed slider: Slider.Indicator spans 0 → value
// by default; this respans it between the track centre and the thumb.
// --start-position is the thumb's inset-adjusted position, set inline by the
// Indicator itself, and user style wins the per-property merge.
const CENTERED_INDICATOR: CSSProperties = {
  insetInlineStart: "min(50%, var(--start-position))",
  width:
    "max(calc(var(--start-position) - 50%), calc(50% - var(--start-position)))",
};

// Single-thumb slider on Base UI's Slider with the label above the track.
// `centered` anchors the fill at the track centre (for signed ranges),
// `ticks` draws detent marks under the track, and `tickCount` sets --major-ticks.
export const Slider = ({
  label,
  value,
  onValueChange,
  min,
  max,
  step,
  disabled,
  centered = false,
  ticks = false,
  tickCount = 6,
}: {
  label: ReactNode;
  value: number;
  onValueChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  disabled: boolean;
  centered?: boolean;
  ticks?: boolean;
  tickCount?: number;
}) => {
  const control = (
    <BaseSlider.Control className={styles.control}>
      <BaseSlider.Indicator
        className={styles.indicator}
        style={centered ? CENTERED_INDICATOR : undefined}
      />
      <BaseSlider.Track className={styles.track}>
        <BaseSlider.Thumb className={styles.thumb} />
      </BaseSlider.Track>
    </BaseSlider.Control>
  );

  return (
    <BaseSlider.Root
      value={value}
      onValueChange={(v) => onValueChange(v)}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      thumbAlignment="edge"
      className={ticks ? `${styles.slider} ${styles.withTicks}` : styles.slider}
    >
      <BaseSlider.Label className={styles.label}>{label}</BaseSlider.Label>
      {ticks ? (
        <div
          className={styles.ticks}
          style={{ "--major-ticks": tickCount } as CSSProperties}
        >
          {control}
        </div>
      ) : (
        control
      )}
    </BaseSlider.Root>
  );
};
