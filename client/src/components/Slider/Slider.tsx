import { CSSProperties, ReactNode } from "react";
import { Slider as BaseSlider } from "@base-ui/react/slider";
import { cx } from "@/helpers";
import styles from "./Slider.module.css";

// Centre-anchored fill for a signed slider: Slider.Indicator spans 0 → value
// by default; this respans it between the track centre and the thumb.
// --start-position is the thumb's inset-adjusted position, set inline by the
// Indicator itself, and user style wins the per-property merge.
const CENTERED_INDICATOR: CSSProperties = {
  insetInlineStart: "min(50%, var(--start-position))",
  width: "max(calc(var(--start-position) - 50%), calc(50% - var(--start-position)))",
};

const MINOR_TICKS = 61;

// `centered` anchors the fill at the track centre (for signed ranges),
// `ticks` draws detent marks under the track, and `tickCount` is the number
// of major-tick intervals (tickCount + 1 marks).
export const Slider = ({
  label,
  value,
  onValueChange,
  min,
  max,
  step,
  disabled,
  centered = false,
  ticks = true,
  tickCount = 2,
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
  const fillRatio = max === min ? 0 : (value - min) / (max - min);
  const minorSteps = MINOR_TICKS - 1;
  const majorTickActive = (index: number) => {
    const pos = index / tickCount;
    if (!centered) return index === 0 || pos <= fillRatio;
    const start = Math.min(fillRatio, 0.5);
    const end = Math.max(fillRatio, 0.5);
    return pos >= start && pos <= end;
  };

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
      className={cx(styles.slider, ticks && styles.withTicks)}
    >
      <BaseSlider.Label className={styles.label}>{label}</BaseSlider.Label>
      {ticks ? (
        <div
          className={cx(styles.ticks, centered && styles.centeredTicks)}
          style={
            {
              "--fill-ratio": fillRatio,
            } as CSSProperties
          }
        >
          {control}
          <div className={styles.minorTicks} aria-hidden="true">
            {Array.from({ length: MINOR_TICKS }, (_, i) => {
              if (tickCount > 0 && (i * tickCount) % minorSteps === 0) {
                return null;
              }
              const pos = i / minorSteps;
              return (
                <span
                  key={i}
                  className={styles.minorTick}
                  style={{ "--pos": pos } as CSSProperties}
                />
              );
            })}
          </div>
          <div className={styles.majorTicks} aria-hidden="true">
            {Array.from({ length: tickCount + 1 }, (_, i) => (
              <span
                key={i}
                className={cx(styles.majorTick, majorTickActive(i) && styles.majorTickActive)}
                style={{ "--pos": i / tickCount } as CSSProperties}
              />
            ))}
          </div>
        </div>
      ) : (
        control
      )}
    </BaseSlider.Root>
  );
};
