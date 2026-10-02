import { ReactNode } from "react";
import {
  Popover as BasePopover,
  type PopoverPositionerProps,
  type PopoverRootProps,
} from "@base-ui/react/popover";
import styles from "./Popover.module.css";

type PositionerProps = Pick<
  PopoverPositionerProps,
  "anchor" | "side" | "align" | "sideOffset" | "alignOffset" | "collisionAvoidance"
>;

// Controlled popover on Base UI's Popover, with no trigger of its own: the
// caller decides when it is `open` and which element it hangs off (`anchor`).
// `onOpenChange` hears outside presses and Escape; leave it out and only
// `open` shuts it.
export const Popover = ({
  open,
  onOpenChange,
  children,
  side = "bottom",
  align = "start",
  sideOffset = 10,
  className,
  ...positioner
}: PositionerProps & {
  open: boolean;
  onOpenChange?: PopoverRootProps["onOpenChange"];
  children: ReactNode;
  className?: string;
}) => (
  <BasePopover.Root open={open} onOpenChange={onOpenChange}>
    <BasePopover.Portal>
      <BasePopover.Positioner
        className={styles.positioner}
        side={side}
        align={align}
        sideOffset={sideOffset}
        {...positioner}
      >
        <BasePopover.Popup
          className={className ? `${styles.popup} ${className}` : styles.popup}
          initialFocus={false}
        >
          {children}
        </BasePopover.Popup>
      </BasePopover.Positioner>
    </BasePopover.Portal>
  </BasePopover.Root>
);
