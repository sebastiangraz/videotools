import { ReactNode, RefObject, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  PreviewCard as BasePreviewCard,
  type PreviewCardTriggerProps,
} from "@base-ui/react/preview-card";
import { PreviewCardPopup } from "@src/components/PreviewCard/PreviewCard";
import { useMessage } from "@src/hooks/useMessage";
import { cx } from "@src/helpers";
import { messageHandle, messages, type MessageEntry } from "./messageStore";
import styles from "./Message.module.css";

// Placeholder until the real SVG lands.
const WarningIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 8 8"
    width="8px"
    className={styles.icon}
  >
    <path
      fill="currentColor"
      d="m4.329 1.19 3.62 6.27a.38.38 0 0 1-.33.57H.38a.38.38 0 0 1-.33-.57l3.62-6.27a.38.38 0 0 1 .659 0M3.62 6.13v.76h.76v-.76zm0-2.66v1.9h.76v-1.9z"
    />
  </svg>
);

// Pulls the card back up over its anchor so it sits centred on the anchor
// instead of below it. A body and its margins are left out, so the card grows
// down as it unfolds.
const centerOverAnchor = (
  { anchor, positioner }: { anchor: { height: number }; positioner: { height: number } },
  body: HTMLElement | null,
) => {
  let below = 0;
  if (body) {
    const { marginTop, marginBottom } = getComputedStyle(body);
    below = body.getBoundingClientRect().height + parseFloat(marginTop) + parseFloat(marginBottom);
  }
  return -(anchor.height + positioner.height - below) / 2;
};

// Where every message shows (see messageStore.ts): one card over `anchor`,
// the layout's title, so it never moves whatever it shows. It is open while
// a <Message> is up or a MessageTrigger is hovered or focused; the message
// wins, so it stays put until it is gone.
export const MessageArea = ({ anchor }: { anchor: RefObject<HTMLElement | null> }) => {
  const { active, message } = useSyncExternalStore(messages.subscribe, messages.getSnapshot);
  const [triggered, setTriggered] = useState(false);
  // The body is unfolded. A click on the message, links aside, toggles it; a
  // click outside, Escape or the message going folds it.
  const [expanded, setExpanded] = useState(false);
  if (expanded && !message) setExpanded(false);
  const body = useRef<HTMLDivElement>(null);

  // A message that goes while a trigger holds the card open hands over to
  // it, and must not come back when the card closes.
  useEffect(() => {
    if (!active && triggered) messages.forget();
  }, [active, triggered]);

  return (
    <BasePreviewCard.Root
      handle={messageHandle}
      open={active || triggered}
      onOpenChange={(open, { reason }) => {
        setTriggered(open);
        if (reason === "outside-press" || reason === "escape-key") setExpanded(false);
      }}
      onOpenChangeComplete={(open) => {
        if (!open) messages.forget();
      }}
    >
      {({ payload }) => {
        // A trigger's excerpt only shows while no message is up. With neither,
        // the card is on its way out and keeps what it was showing: the
        // message it had, else the last trigger's excerpt (Base UI keeps the
        // payload, so that alone doesn't tell a trigger's excerpt is shown).
        const triggerShown = !active && (triggered || !message);
        const error = !triggerShown && message?.kind === "error";
        return (
          <PreviewCardPopup
            popupClassName={cx(styles.message, error && styles.error, expanded && styles.expanded)}
            anchor={anchor}
            side="bottom"
            align="end"
            sideOffset={(data) => centerOverAnchor(data, body.current)}
            alignOffset={-2}
            collisionAvoidance={{
              side: "none",
              align: "none",
              fallbackAxisSide: "none",
            }}
          >
            {triggerShown ? (
              <div className={styles.excerpt}>{payload}</div>
            ) : (
              message && (
                <div
                  role={error ? "alert" : "status"}
                  className={styles.content}
                  onClick={(event) => {
                    if (message.body && !(event.target as Element).closest("a")) {
                      setExpanded(!expanded);
                    }
                  }}
                >
                  <div className={styles.excerpt}>
                    {error && <WarningIcon />}
                    {message.excerpt}
                  </div>
                  {message.body && (
                    <div ref={body} className={styles.body}>
                      {message.body}
                    </div>
                  )}
                </div>
              )
            )}
          </PreviewCardPopup>
        );
      }}
    </BasePreviewCard.Root>
  );
};

// Says `excerpt` in the area while it is hovered or focused.
export const MessageTrigger = ({
  excerpt,
  render,
  children,
}: {
  excerpt: ReactNode;
  render: PreviewCardTriggerProps["render"];
  children: ReactNode;
}) => (
  <BasePreviewCard.Trigger handle={messageHandle} payload={excerpt} delay={200} render={render}>
    {children}
  </BasePreviewCard.Trigger>
);

// useMessage as markup: the message is up while this is mounted, so render it
// for as long as what it says holds. It renders nothing where it stands.
export const Message = (message: MessageEntry) => {
  useMessage(message);
  return null;
};
