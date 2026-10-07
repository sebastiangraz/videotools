import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup as BaseToggleGroup } from "@base-ui/react/toggle-group";
import styles from "./ToggleGroup.module.css";

// Segmented single-choice control on Base UI's ToggleGroup, with text labels.
// Base UI works in arrays and lets the pressed item be toggled off; here the
// value is a single string and one item always stays pressed. The group is a
// div, not a form control, so it is named by `labelledBy` (the id of a
// visible label) rather than a <label htmlFor>. With `toggle`, pressing the
// pressed item flips to the other one, so it takes exactly two options.
type Option<T> = { value: T; label: string };

export const ToggleGroup = <T extends string>({
  options,
  toggle,
  value,
  onValueChange,
  disabled,
  labelledBy,
  size = "default",
}: (
  | { options: readonly Option<T>[]; toggle?: false }
  | { options: readonly [Option<T>, Option<T>]; toggle: true }
) & {
  value: T;
  onValueChange: (value: T) => void;
  disabled: boolean;
  labelledBy?: string;
  size?: "default" | "small";
}) => (
  <BaseToggleGroup
    value={[value]}
    onValueChange={(next) => {
      if (next.length > 0) onValueChange(next[0] as T);
      else if (toggle) onValueChange(options[options[0].value === value ? 1 : 0].value);
    }}
    disabled={disabled}
    aria-labelledby={labelledBy}
    className={styles.root}
    data-size={size}
  >
    {options.map((option) => (
      <Toggle key={option.value} value={option.value} className={styles.item}>
        {option.label}
      </Toggle>
    ))}
  </BaseToggleGroup>
);
