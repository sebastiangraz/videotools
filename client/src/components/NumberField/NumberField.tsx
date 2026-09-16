import { ReactNode } from "react";
import { NumberField as BaseNumberField } from "@base-ui/react/number-field";
import { PreviewCard } from "../PreviewCard/PreviewCard";
import styles from "./NumberField.module.css";

// Duration fields render with a seconds unit ("2.1s"). Base UI derives the
// unit label from the format options, so it also strips it back off when
// parsing typed input. One forced decimal keeps whole numbers looking like
// the fractional steps they're nudged in ("1.0s", not "1s").
const SECONDS_FORMAT: Intl.NumberFormatOptions = {
  style: "unit",
  unit: "second",
  unitDisplay: "narrow",
  minimumFractionDigits: 1,
};

// Decimal entry on Base UI's NumberField. Typed values are parsed with the
// browser locale ("0,5" and "0.5" both work where the locale allows). An
// optional `preview` renders in a PreviewCard anchored to the input, opened
// by the card's own hover/focus-on-trigger behaviour. `format` defaults to
// the seconds unit; pass another Intl.NumberFormatOptions (or plain digits
// via {maximumFractionDigits: 0}) for non-duration fields.
export const NumberField = ({
  id,
  value,
  onValueChange,
  min,
  max,
  step,
  largeStep,
  disabled,
  preview,
  format = SECONDS_FORMAT,
  placeholder,
}: {
  id: string;
  value: number | null;
  onValueChange: (value: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  largeStep?: number;
  disabled: boolean;
  preview?: ReactNode;
  format?: Intl.NumberFormatOptions;
  placeholder?: string;
}) => (
  <BaseNumberField.Root
    id={id}
    value={value}
    onValueChange={onValueChange}
    min={min}
    max={max}
    step={step}
    largeStep={largeStep}
    format={format}
    allowWheelScrub={true}
    disabled={disabled}
  >
    <PreviewCard
      render={<BaseNumberField.Group className={styles.group} />}
      content={preview}
      side="top"
      align="center"
      sideOffset={8}
    >
      <BaseNumberField.Input
        className={styles.input}
        placeholder={placeholder}
      />
      <div className={styles.steppers}>
        <BaseNumberField.Increment className={styles.button}>
          +
        </BaseNumberField.Increment>
        <BaseNumberField.Decrement className={styles.button}>
          −
        </BaseNumberField.Decrement>
      </div>
    </PreviewCard>
  </BaseNumberField.Root>
);
