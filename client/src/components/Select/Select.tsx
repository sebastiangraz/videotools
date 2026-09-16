import { Select as BaseSelect } from "@base-ui/react/select";
import styles from "./Select.module.css";

export type SelectOption = { value: string; label: string };

// Dropdown on Base UI's Select. The trigger takes the id so an external
// <label htmlFor> keeps working.
export const Select = ({
  id,
  options,
  value,
  onValueChange,
  disabled,
}: {
  id: string;
  options: SelectOption[];
  value: string;
  onValueChange: (value: string) => void;
  disabled: boolean;
}) => (
  <BaseSelect.Root
    items={options}
    value={value}
    onValueChange={(v) => v !== null && onValueChange(v)}
    disabled={disabled}
  >
    <BaseSelect.Trigger id={id} className={styles.trigger}>
      <BaseSelect.Value />
      <svg
        className={styles.caret}
        viewBox="0 0 10 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M1 1l4 4 4-4" />
      </svg>
    </BaseSelect.Trigger>
    <BaseSelect.Portal>
      <BaseSelect.Positioner
        className={styles.positioner}
        align="start"
        sideOffset={4}
        alignItemWithTrigger={true}
      >
        <BaseSelect.Popup className={styles.popup}>
          {options.map((o) => (
            <BaseSelect.Item
              key={o.value}
              value={o.value}
              className={styles.item}
            >
              <BaseSelect.ItemIndicator
                keepMounted
                className={styles.itemIndicator}
              >
                {null}
              </BaseSelect.ItemIndicator>
              <BaseSelect.ItemText>{o.label}</BaseSelect.ItemText>
            </BaseSelect.Item>
          ))}
        </BaseSelect.Popup>
      </BaseSelect.Positioner>
    </BaseSelect.Portal>
  </BaseSelect.Root>
);
