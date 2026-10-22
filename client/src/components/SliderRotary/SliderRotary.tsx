import { CSSProperties, PointerEvent, ReactNode, useRef } from "react";
import { Slider as BaseSlider } from "@base-ui/react/slider";
import { cx } from "@src/helpers";
import styles from "./SliderRotary.module.css";

// Base UI places the thumb along a linear track, centred on the cross axis;

const KNOB_STYLE: CSSProperties = { insetInlineStart: "50%" };

const SWEEP = 270;
const DRAG_RANGE = 200;
const DOTS = [0, 0.5, 1];

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
              r="3"
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
