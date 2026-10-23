import { CSSProperties, ReactNode } from "react";
import { Slider as BaseSlider } from "@base-ui/react/slider";
import { cx } from "@src/helpers";
import styles from "./Slider.module.css";

// Centre-anchored fill for a signed slider: Slider.Indicator spans 0 → value
// by default; this respans it between the track centre and the thumb.
// --start-position is the thumb's inset-adjusted position, set inline by the
// Indicator itself, and user style wins the per-property merge.
const CENTERED_INDICATOR: CSSProperties = {
  insetInlineStart: "min(50%, var(--start-position))",
  width: "max(calc(var(--start-position) - 50%), calc(50% - var(--start-position)))",
};

const MINOR_PIPS = 61;

// `centered` anchors the fill at the track centre (for signed ranges),
// `pips` draws detent marks under the track, and `pipCount` is the number
// of major-pip intervals (pipCount + 1 major pips).
export const Slider = ({
  label,
  value,
  onValueChange,
  min,
  max,
  step,
  disabled,
  centered = false,
  pips = true,
  pipCount = 2,
}: {
  label: ReactNode;
  value: number;
  onValueChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  disabled: boolean;
  centered?: boolean;
  pips?: boolean;
  pipCount?: number;
}) => {
  const fillRatio = max === min ? 0 : (value - min) / (max - min);
  const minorSteps = MINOR_PIPS - 1;
  const majorPipActive = (index: number) => {
    const pos = index / pipCount;
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
      className={cx(styles.slider, pips && styles.withPips)}
    >
      <BaseSlider.Label className={styles.label}>{label}</BaseSlider.Label>
      {pips ? (
        <div
          className={cx(styles.pips, centered && styles.centeredPips)}
          style={
            {
              "--fill-ratio": fillRatio,
            } as CSSProperties
          }
        >
          {control}
          <div className={styles.minorPips} aria-hidden="true">
            {Array.from({ length: MINOR_PIPS }, (_, i) => {
              if (pipCount > 0 && (i * pipCount) % minorSteps === 0) {
                return null;
              }
              const pos = i / minorSteps;
              return (
                <span
                  key={i}
                  className={styles.minorPip}
                  style={{ "--pos": pos } as CSSProperties}
                />
              );
            })}
          </div>
          <div className={styles.majorPips} aria-hidden="true">
            {Array.from({ length: pipCount + 1 }, (_, i) => (
              <span
                key={i}
                className={cx(styles.majorPip, majorPipActive(i) && styles.majorPipActive)}
                style={{ "--pos": i / pipCount } as CSSProperties}
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
