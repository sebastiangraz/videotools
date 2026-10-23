import { CSSProperties, Fragment, PointerEvent, ReactNode, useRef } from "react";
import { Slider as BaseSlider } from "@base-ui/react/slider";
import { cx } from "@src/helpers";
import styles from "./SliderRotary.module.css";

const KNOB_STYLE: CSSProperties = { insetInlineStart: "50%" };

const SWEEP = 270;
const DRAG_RANGE = 4; // Knob widths per full sweep, so bigger dials turn finer.
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
  pipClickable = false,
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
  pipActiveStyle?: "default" | "single" | "snake";
  pipClickable?: boolean;
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const hitAreaRef = useRef<HTMLSpanElement>(null);
  const drag = useRef<{
    y: number;
    fill: number;
    sign: number;
    range: number;
    rect?: DOMRect;
  } | null>(null);
  const fill = max === min ? 0 : (value - min) / (max - min);
  const start = centered ? Math.min(fill, 0.5) : 0;
  const end = centered ? Math.max(fill, 0.5) : fill;

  const commit = (next: number) => {
    next = Math.min(1, Math.max(0, next));
    onValueChange(Number((min + Math.round((next * (max - min)) / step) * step).toPrecision(12)));
  };

  // After the press has moved focus off the input.
  const refocus = () =>
    requestAnimationFrame(() =>
      inputRef.current?.focus({ preventScroll: true, focusVisible: false }),
    );

  const turn = ({ clientX, clientY }: PointerEvent<HTMLElement>) => {
    if (!drag.current) return;
    const { y, sign, range, rect } = drag.current;
    let next = drag.current.fill + (sign * (y - clientY)) / range;
    if (rect) {
      const x = clientX - rect.left - rect.width / 2;
      const angle = Math.atan2(x, rect.top + rect.height / 2 - clientY);
      next = (angle * 180) / Math.PI / SWEEP + 0.5;
      // In the gap below the dial, hold the end the value is nearer.
      if (next < 0 || next > 1) next = Math.round(fill);
    }
    commit(next);
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
            const inRange = pos >= start && pos <= end;
            // Every pip in range has been passed, unless the indicator sits right on it.
            const eaten =
              pipActiveStyle === "snake" &&
              inRange &&
              Math.abs(fill - pos) * (pipCount - 1) > 1e-9;
            const active =
              pipActiveStyle === "single"
                ? i === Math.round(fill * (pipCount - 1)) &&
                  // Sparse pips sit far apart, so only light one the indicator is near.
                  (pipCount >= 4 || Math.abs(fill - pos) * SWEEP <= PIP_REACH)
                : inRange && !eaten;
            const rotate = { rotate: `${(pos - 0.5) * SWEEP}deg` };
            return (
              <Fragment key={i}>
                {pipClickable && (
                  <circle
                    className={styles.pipHit}
                    cx="50%"
                    style={rotate}
                    onPointerDown={(event) => {
                      if (disabled || event.button !== 0) return;
                      commit(pos);
                      refocus();
                    }}
                  />
                )}
                <circle
                  className={cx(styles.pip, active && styles.pipActive, eaten && styles.pipEaten)}
                  cx="50%"
                  style={rotate}
                />
              </Fragment>
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
            drag.current = {
              y: event.clientY,
              fill,
              sign,
              range: rect.width * DRAG_RANGE,
              rect: precise ? rect : undefined,
            };
            if (precise) turn(event);
            refocus();
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
