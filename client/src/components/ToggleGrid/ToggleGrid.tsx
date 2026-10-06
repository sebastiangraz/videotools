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
  // Lights the cells in turn from the pressed one, as the mark hops in the output.
  shuffling?: boolean;
}) => (
  <BaseToggleGroup
    value={[value]}
    onValueChange={(next) => {
      if (next.length > 0) onValueChange(next[0] as T);
    }}
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
    {/* The pressed mark, one element that slides to the pressed dot. */}
    <span aria-hidden="true" className={styles.active} />
    {/* The lattice slides with the tile; its fade is fixed, so the mask sits on this wrapper. */}
    <span aria-hidden="true" className={styles.field}>
      <span className={styles.lattice} />
    </span>
  </BaseToggleGroup>
);
