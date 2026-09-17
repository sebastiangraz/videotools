import { Switch as BaseSwitch } from "@base-ui/react/switch";
import styles from "./Switch.module.css";

// On/off toggle on Base UI's Switch. The id lands on the hidden input, so an
// external <label htmlFor> names the switch (Base UI copies it over as
// aria-labelledby) and clicking the label flips it.
export const Switch = ({
  id,
  checked,
  onCheckedChange,
  disabled,
}: {
  id: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled: boolean;
}) => (
  <BaseSwitch.Root
    id={id}
    checked={checked}
    onCheckedChange={onCheckedChange}
    disabled={disabled}
    className={styles.root}
  >
    <BaseSwitch.Thumb className={styles.thumb} />
  </BaseSwitch.Root>
);
