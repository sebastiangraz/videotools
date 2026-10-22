import { CSSProperties, ReactNode, useRef } from "react";
import { Slider as BaseSlider } from "@base-ui/react/slider";
import { cx } from "@src/helpers";
import styles from "./SliderRotary.module.css";

// Base UI places the thumb along a linear track, centred on the cross axis;
// pinning the inline start to 50% too parks it as the knob.
const KNOB_STYLE: CSSProperties = { insetInlineStart: "50%" };

// Degrees the knob turns across the range, and px of vertical drag to cover it.
const SWEEP = 270;
const DRAG_RANGE = 200;
const DOTS = [0, 0.5, 1];

// Slider's cousin as a knob: drag up/down or use the keys. `centered`
// anchors the arc at the top (for signed ranges).
export const SliderRotary = ({
  label,
  value,
  onValueChange,
  min,
  max,
  step,
  disabled,
  centered = false,
}: {
  label: ReactNode;
  value: number;
  onValueChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  disabled: boolean;
  centered?: boolean;
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const drag = useRef<{ y: number; fill: number } | null>(null);
  const fill = max === min ? 0 : (value - min) / (max - min);
  const start = centered ? Math.min(fill, 0.5) : 0;
  const end = centered ? Math.max(fill, 0.5) : fill;

  return (
    <BaseSlider.Root
      value={value}
      onValueChange={(v) => onValueChange(v)}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      className={styles.slider}
    >
      <BaseSlider.Label className={styles.label}>{label}</BaseSlider.Label>
      <div
        className={styles.dial}
        style={{ "--angle": `${(fill - 0.5) * SWEEP}deg` } as CSSProperties}
      >
        <svg className={styles.marks} viewBox="0 0 100 100" aria-hidden="true">
          <circle
            className={styles.arc}
            cx="50"
            cy="50"
            r="47"
            pathLength={360}
            strokeDasharray={`${(end - start) * SWEEP} 360`}
            transform={`rotate(${(start - 0.5) * SWEEP - 90} 50 50)`}
          />
          {DOTS.map((pos) => (
            <circle
              key={pos}
              className={cx(styles.dot, pos >= start && pos <= end && styles.dotActive)}
              cx="50"
              cy="3"
              r="1.75"
              transform={`rotate(${(pos - 0.5) * SWEEP} 50 50)`}
            />
          ))}
        </svg>
        <BaseSlider.Thumb
          className={styles.knob}
          style={KNOB_STYLE}
          inputRef={inputRef}
          onPointerDown={(event) => {
            if (disabled || event.button !== 0) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = { y: event.clientY, fill };
            // After the press has moved focus off the input.
            requestAnimationFrame(() =>
              inputRef.current?.focus({ preventScroll: true, focusVisible: false }),
            );
          }}
          onPointerMove={(event) => {
            if (!drag.current) return;
            const moved = (drag.current.y - event.clientY) / DRAG_RANGE;
            const next = Math.min(1, Math.max(0, drag.current.fill + moved));
            onValueChange(
              Number((min + Math.round((next * (max - min)) / step) * step).toPrecision(12)),
            );
          }}
          onLostPointerCapture={() => {
            drag.current = null;
          }}
        />
      </div>
    </BaseSlider.Root>
  );
};
