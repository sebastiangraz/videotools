import { CSSProperties, PointerEvent, ReactNode, useRef } from "react";
import { Slider as BaseSlider } from "@base-ui/react/slider";
import { cx } from "@src/helpers";
import styles from "./SliderRotary.module.css";

const KNOB_STYLE: CSSProperties = { insetInlineStart: "50%" };

const SWEEP = 270;
const DRAG_RANGE = 200;
const PIP_REACH = 6;

export const SliderRotary = ({
  label,
  value,
  onValueChange,
  min,
  max,
  step,
  disabled,
  centered = false,
  showArc = true,
  size,
  pipCount = 3,
  pipActiveStyle = "default",
}: {
  label: ReactNode;
  value: number;
  onValueChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  disabled: boolean;
  centered?: boolean;
  showArc?: boolean;
  size?: string;
  pipCount?: number;
  pipActiveStyle?: "default" | "single";
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const hitAreaRef = useRef<HTMLSpanElement>(null);
  const drag = useRef<{ y: number; fill: number; sign: number; rect?: DOMRect } | null>(null);
  const fill = max === min ? 0 : (value - min) / (max - min);
  const start = centered ? Math.min(fill, 0.5) : 0;
  const end = centered ? Math.max(fill, 0.5) : fill;

  const turn = ({ clientX, clientY }: PointerEvent<HTMLElement>) => {
    if (!drag.current) return;
    const { y, sign, rect } = drag.current;
    let next = drag.current.fill + (sign * (y - clientY)) / DRAG_RANGE;
    if (rect) {
      const x = clientX - rect.left - rect.width / 2;
      const angle = Math.atan2(x, rect.top + rect.height / 2 - clientY);
      next = (angle * 180) / Math.PI / SWEEP + 0.5;
      // In the gap below the dial, hold the end the value is nearer.
      if (next < 0 || next > 1) next = Math.round(fill);
    }
    next = Math.min(1, Math.max(0, next));
    onValueChange(Number((min + Math.round((next * (max - min)) / step) * step).toPrecision(12)));
  };

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
        style={{ "--angle": `${(fill - 0.5) * SWEEP}deg`, "--size": size } as CSSProperties}
      >
        <svg className={styles.marks} aria-hidden="true">
          {showArc && (
            <circle
              className={cx(styles.arc, centered && styles.arcCentered)}
              cx="50%"
              cy="50%"
              pathLength={360}
              strokeDasharray={`${(end - start) * SWEEP} 360`}
              style={{ rotate: `${(start - 0.5) * SWEEP - 90}deg` }}
            />
          )}
          {Array.from({ length: pipCount }, (_, i) => {
            const pos = i / (pipCount - 1);
            const active =
              pipActiveStyle === "single"
                ? i === Math.round(fill * (pipCount - 1)) &&
                  // Sparse pips sit far apart, so only light one the indicator is near.
                  (pipCount >= 4 || Math.abs(fill - pos) * SWEEP <= PIP_REACH)
                : pos >= start && pos <= end;
            return (
              <circle
                key={i}
                className={cx(styles.pip, active && styles.pipActive)}
                cx="50%"
                style={{ rotate: `${(pos - 0.5) * SWEEP}deg` }}
              />
            );
          })}
        </svg>
        <BaseSlider.Thumb
          className={styles.knob}
          style={KNOB_STYLE}
          inputRef={inputRef}
          onPointerDown={(event) => {
            if (disabled || event.button !== 0) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            const precise = hitAreaRef.current?.contains(event.target as Node);
            const rect = event.currentTarget.getBoundingClientRect();
            // Like a real knob, pushing up on the right half turns it anticlockwise.
            const sign = event.clientX > rect.left + rect.width / 2 ? -1 : 1;
            drag.current = { y: event.clientY, fill, sign, rect: precise ? rect : undefined };
            if (precise) turn(event);
            // After the press has moved focus off the input.
            requestAnimationFrame(() =>
              inputRef.current?.focus({ preventScroll: true, focusVisible: false }),
            );
          }}
          onPointerMove={turn}
          onLostPointerCapture={() => {
            drag.current = null;
          }}
        >
          <span ref={hitAreaRef} className={styles.hitArea} />
        </BaseSlider.Thumb>
      </div>
    </BaseSlider.Root>
  );
};
