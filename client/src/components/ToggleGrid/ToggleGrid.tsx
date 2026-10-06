import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup as BaseToggleGroup } from "@base-ui/react/toggle-group";
import type { CSSProperties } from "react";
import styles from "./ToggleGrid.module.css";

export const ToggleGrid = <T extends string>({
  options,
  value,
  onValueChange,
  disabled,
  labelledBy,
  shuffling = false,
}: {
  options: readonly T[];
  value: T;
  onValueChange: (value: T) => void;
  disabled: boolean;
  labelledBy?: string;
  shuffling?: boolean;
}) => (
  <BaseToggleGroup
    value={[value]}
    onValueChange={(next) => onValueChange(next.length > 0 ? (next[0] as T) : value)}
    disabled={disabled}
    aria-labelledby={labelledBy}
    className={shuffling ? `${styles.root} ${styles.shuffling}` : styles.root}
    style={{ "--at": options.indexOf(value) } as CSSProperties}
  >
    {options.map((option, i) => (
      <Toggle
        key={option}
        value={option}
        aria-label={option}
        className={styles.item}
        style={{ "--i": i } as CSSProperties}
      />
    ))}
    <span aria-hidden="true" className={styles.active} />
    <span aria-hidden="true" className={styles.field}>
      <span className={styles.lattice} />
    </span>
  </BaseToggleGroup>
);
