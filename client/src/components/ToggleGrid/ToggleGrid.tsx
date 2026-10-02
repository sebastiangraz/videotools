import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup as BaseToggleGroup } from "@base-ui/react/toggle-group";
import styles from "./ToggleGrid.module.css";

export const ToggleGrid = <T extends string>({
  options,
  value,
  onValueChange,
  disabled,
  labelledBy,
}: {
  options: readonly T[];
  value: T;
  onValueChange: (value: T) => void;
  disabled: boolean;
  labelledBy?: string;
}) => (
  <BaseToggleGroup
    value={[value]}
    onValueChange={(next) => {
      if (next.length > 0) onValueChange(next[0] as T);
    }}
    disabled={disabled}
    aria-labelledby={labelledBy}
    className={styles.root}
  >
    {options.map((option) => (
      <Toggle key={option} value={option} aria-label={option} className={styles.item} />
    ))}
  </BaseToggleGroup>
);
