import { ReactNode } from "react";
import {
  PreviewCard as BasePreviewCard,
  type PreviewCardPositionerProps,
  type PreviewCardTriggerProps,
} from "@base-ui/react/preview-card";
import { cx } from "@/helpers";
import styles from "./PreviewCard.module.css";

type PositionerProps = Pick<
  PreviewCardPositionerProps,
  "anchor" | "side" | "align" | "sideOffset" | "alignOffset" | "collisionAvoidance"
>;

// The card without a root, for use under a Base UI PreviewCard.Root:
// PreviewCard below, or a root of one's own (components/Message, whose
// triggers are detached).
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
      <BasePreviewCard.Popup className={cx(styles.popup, popupClassName)}>
        {children}
      </BasePreviewCard.Popup>
    </BasePreviewCard.Positioner>
  </BasePreviewCard.Portal>
);

// `render` supplies the trigger element (a Link, a NumberField.Group, ...) and
// `children` its contents. When `content` is empty the portal is skipped
// entirely, so callers can pass a conditional without the trigger ever
// unmounting.
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
