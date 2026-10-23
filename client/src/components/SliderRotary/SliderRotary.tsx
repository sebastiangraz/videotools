import {
  CSSProperties,
  Fragment,
  PointerEvent,
  ReactNode,
  useEffect,
  useEffectEvent,
  useRef,
} from "react";
import { Slider as BaseSlider } from "@base-ui/react/slider";
import { cx } from "@src/helpers";
import styles from "./SliderRotary.module.css";

const KNOB_STYLE: CSSProperties = { insetInlineStart: "50%" };

const SWEEP = 270;
const DRAG_RANGE = 4; // Knob widths per full sweep, so bigger dials turn finer.
const PIP_REACH = 6;
const WHEEL_NOTCH = 100; // Pixels per wheel step, as Chrome reports one notch at 3 lines.
const WHEEL_LINE = 33; // Pixels per line, so Firefox's line deltas match Chrome's.

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
  wheelSteps = Math.max(1, pipCount - 1),
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
  /** Wheel notches per full sweep. Defaults to landing on each pip. */
  wheelSteps?: number;
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const hitAreaRef = useRef<HTMLSpanElement>(null);
  const dialRef = useRef<HTMLDivElement>(null);
  // The exact wheel stop, since committed values are rounded to the step,
  // and the pixels short of the next one, so touchpad deltas add up.
  const wheel = useRef<{ fill: number; value: number; pixels: number } | null>(null);
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
    const committed = Number(
      (min + Math.round((next * (max - min)) / step) * step).toPrecision(12),
    );
    onValueChange(committed);
    return committed;
  };

  useEffect(() => {
    if (wheel.current?.value !== value) wheel.current = null;
  }, [value]);

  const onWheel = useEffectEvent((event: WheelEvent) => {
    const input = inputRef.current;
    if (!input || input.ownerDocument.activeElement !== input) return;
    // Some browsers deliver shift + wheel on the horizontal axis.
    const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
    const delta = event.shiftKey && horizontal ? event.deltaX : event.deltaY;
    // Leave pinch-zoom and horizontal scrolling to the page.
    if (event.ctrlKey || delta === 0 || (horizontal && !event.shiftKey)) return;
    event.preventDefault();
    const state = (wheel.current ??= { fill, value, pixels: 0 });
    const pixels = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? delta * WHEEL_LINE : delta;
    // The OS scroll speed scales a mouse notch, so cap each event at one.
    state.pixels += Math.max(-WHEEL_NOTCH, Math.min(WHEEL_NOTCH, pixels));
    const notches = Math.trunc(state.pixels / WHEEL_NOTCH);
    if (notches === 0) return;
    state.pixels -= notches * WHEEL_NOTCH;
    const pos = state.fill * wheelSteps;
    // A value rounded off a stop still counts as on it.
    const slack = (step / (max - min)) * wheelSteps * 0.5;
    // Wheeling up (negative delta) turns clockwise.
    const target =
      notches < 0 ? Math.floor(pos + slack) - notches : Math.ceil(pos - slack) - notches;
    state.fill = Math.min(wheelSteps, Math.max(0, target)) / wheelSteps;
    state.value = commit(state.fill);
  });

  // React's onWheel is passive, so it can't stop the page from scrolling.
  useEffect(() => {
    const dial = dialRef.current;
    if (disabled || !dial) return;
    const listener = (event: WheelEvent) => onWheel(event);
    dial.addEventListener("wheel", listener, { passive: false });
    return () => dial.removeEventListener("wheel", listener);
  }, [disabled]);

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
        ref={dialRef}
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
              pipActiveStyle === "snake" && inRange && Math.abs(fill - pos) * (pipCount - 1) > 1e-9;
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
