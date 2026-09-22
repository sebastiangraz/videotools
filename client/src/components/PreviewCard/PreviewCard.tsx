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

// The card itself: portal, positioner and the popup with its enter/exit
// animation. For use under a Base UI PreviewCard.Root — PreviewCard below, or
// a root of one's own (components/Message, whose triggers are detached).
// Positioning props go straight to the Positioner.
export const PreviewCardPopup = ({
  children,
  popupClassName,
  ...positioner
}: PositionerProps & {
  children: ReactNode;
  popupClassName?: string;
}) => (
  <BasePreviewCard.Portal>
    <BasePreviewCard.Positioner className={styles.positioner} {...positioner}>
      <BasePreviewCard.Popup
        className={
          popupClassName ? `${styles.popup} ${popupClassName}` : styles.popup
        }
      >
        {children}
      </BasePreviewCard.Popup>
    </BasePreviewCard.Positioner>
  </BasePreviewCard.Portal>
);

// Hover/focus preview on Base UI's PreviewCard. `render` supplies the trigger
// element (a Link, a NumberField.Group, ...) and `children` its contents. The
// card shows `content`; when that's empty the portal is skipped entirely, so
// callers can pass a conditional without the trigger ever unmounting.
export const PreviewCard = ({
  render,
  children,
  content,
  delay = 200,
  ...popup
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
    {content ? <PreviewCardPopup {...popup}>{content}</PreviewCardPopup> : null}
  </BasePreviewCard.Root>
);
