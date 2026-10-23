import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup as BaseToggleGroup } from "@base-ui/react/toggle-group";
import styles from "./ToggleGroup.module.css";

type Option<T> = { value: T; label: string };

// Single-choice segmented control that always keeps one item pressed; with `toggle` (exactly two options), pressing the active item selects the other.
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
