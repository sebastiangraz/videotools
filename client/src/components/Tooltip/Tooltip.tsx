import { ReactNode } from "react";
import {
  Tooltip as BaseTooltip,
  type TooltipPositionerProps,
  type TooltipTriggerProps,
} from "@base-ui/react/tooltip";
import { cx } from "@src/helpers";
import styles from "./Tooltip.module.css";

type PositionerProps = Pick<
  TooltipPositionerProps,
  "side" | "align" | "sideOffset" | "alignOffset"
>;

// `render` supplies the trigger element and `children` its contents. Set
// `disabled` to keep the trigger interactive while the tooltip stays shut, and
// `stretch` to match the popup's width to the trigger's.
export const Tooltip = ({
  render,
  children,
  content,
  disabled = false,
  delay = 100,
  closeOnClick = false,
  stretch = false,
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
  stretch?: boolean;
}) => (
  <BaseTooltip.Root disabled={disabled}>
    <BaseTooltip.Trigger delay={delay} closeOnClick={closeOnClick} render={render}>
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
        <BaseTooltip.Popup className={cx(styles.popup, stretch && styles.stretch)}>
          {content}
        </BaseTooltip.Popup>
      </BaseTooltip.Positioner>
    </BaseTooltip.Portal>
  </BaseTooltip.Root>
);
