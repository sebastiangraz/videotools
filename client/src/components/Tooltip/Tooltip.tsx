import { ReactNode } from "react";
import {
  Tooltip as BaseTooltip,
  type TooltipPositionerProps,
  type TooltipTriggerProps,
} from "@base-ui/react/tooltip";
import styles from "./Tooltip.module.css";

type PositionerProps = Pick<
  TooltipPositionerProps,
  "side" | "align" | "sideOffset" | "alignOffset"
>;

// Hover/focus tooltip on Base UI's Tooltip. `render` supplies the trigger
// element and `children` its contents; `content` is the tooltip text. Set
// `disabled` to keep the trigger interactive while the tooltip stays shut.
export const Tooltip = ({
  render,
  children,
  content,
  disabled = false,
  delay = 100,
  closeOnClick = false,
  side = "bottom",
  align = "start",
  sideOffset = 10,
  alignOffset,
}: PositionerProps & {
  render: TooltipTriggerProps["render"];
  children: ReactNode;
  content: ReactNode;
  disabled?: boolean;
  delay?: number;
  closeOnClick?: boolean;
}) => (
  <BaseTooltip.Root disabled={disabled}>
    <BaseTooltip.Trigger
      delay={delay}
      closeOnClick={closeOnClick}
      render={render}
    >
      {children}
    </BaseTooltip.Trigger>
    <BaseTooltip.Portal>
      <BaseTooltip.Positioner
        className={styles.positioner}
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
      >
        <BaseTooltip.Popup className={styles.popup}>{content}</BaseTooltip.Popup>
      </BaseTooltip.Positioner>
    </BaseTooltip.Portal>
  </BaseTooltip.Root>
);
