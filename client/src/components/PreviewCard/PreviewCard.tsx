import { ReactNode } from "react";
import {
  PreviewCard as BasePreviewCard,
  type PreviewCardPositionerProps,
  type PreviewCardTriggerProps,
} from "@base-ui/react/preview-card";
import styles from "./PreviewCard.module.css";

type PositionerProps = Pick<
  PreviewCardPositionerProps,
  | "anchor"
  | "side"
  | "align"
  | "sideOffset"
  | "alignOffset"
  | "collisionAvoidance"
>;

// Hover/focus preview on Base UI's PreviewCard. `render` supplies the trigger
// element (a Link, a NumberField.Group, ...) and `children` its contents. The
// card shows `content`; when that's empty the portal is skipped entirely, so
// callers can pass a conditional without the trigger ever unmounting.
// Positioning props go straight to the Positioner.
export const PreviewCard = ({
  render,
  children,
  content,
  delay = 200,
  popupClassName,
  ...positioner
}: PositionerProps & {
  render: PreviewCardTriggerProps["render"];
  children: ReactNode;
  content: ReactNode;
  delay?: number;
  popupClassName?: string;
}) => (
  <BasePreviewCard.Root>
    <BasePreviewCard.Trigger delay={delay} render={render}>
      {children}
    </BasePreviewCard.Trigger>
    {content ? (
      <BasePreviewCard.Portal>
        <BasePreviewCard.Positioner
          className={styles.positioner}
          {...positioner}
        >
          <BasePreviewCard.Popup
            className={
              popupClassName
                ? `${styles.popup} ${popupClassName}`
                : styles.popup
            }
          >
            {content}
          </BasePreviewCard.Popup>
        </BasePreviewCard.Positioner>
      </BasePreviewCard.Portal>
    ) : null}
  </BasePreviewCard.Root>
);
