import {
  ReactNode,
  RefObject,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import {
  PreviewCard as BasePreviewCard,
  type PreviewCardTriggerProps,
} from "@base-ui/react/preview-card";
import { PreviewCardPopup } from "../PreviewCard/PreviewCard";
import { useMessage } from "../../hooks/useMessage";
import { messageHandle, messages, type MessageKind } from "./messageStore";
import styles from "./Message.module.css";

// Placeholder until the real SVG lands.
const WarningIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 8 8"
    width="8px"
  >
    <path
      fill="currentColor"
      d="m4.329 1.19 3.62 6.27a.38.38 0 0 1-.33.57H.38a.38.38 0 0 1-.33-.57l3.62-6.27a.38.38 0 0 1 .659 0M3.62 6.13v.76h.76v-.76zm0-2.66v1.9h.76v-1.9z"
    />
  </svg>
);

// Pulls the card back up over its anchor so it sits centred on the anchor
// instead of below it
const centerOverAnchor = ({
  anchor,
  positioner,
}: {
  anchor: { height: number };
  positioner: { height: number };
}) => -(anchor.height + positioner.height) / 2;

// Where every message shows (see messageStore.ts): one card over `anchor`,
// the layout's title, so it never moves whoever is speaking. It is open while
// a <Message> is up or a MessageTrigger is hovered or focused; the message
// wins, so it stays put until it is gone.
export const MessageArea = ({
  anchor,
}: {
  anchor: RefObject<HTMLElement | null>;
}) => {
  const { active, message } = useSyncExternalStore(
    messages.subscribe,
    messages.getSnapshot,
  );
  const [triggered, setTriggered] = useState(false);

  // A message that goes while a trigger holds the card open hands over to
  // it, and must not come back when the card closes.
  useEffect(() => {
    if (!active && triggered) messages.forget();
  }, [active, triggered]);

  return (
    <BasePreviewCard.Root
      handle={messageHandle}
      open={active || triggered}
      onOpenChange={setTriggered}
      onOpenChangeComplete={(open) => {
        if (!open) messages.forget();
      }}
    >
      {({ payload }) => {
        // A trigger only gets a word in while no message is up. With neither,
        // the card is on its way out and keeps what it was showing: the
        // message it had, else the last trigger's say (Base UI keeps the
        // payload, so that alone doesn't tell a trigger is speaking).
        const triggerSpeaks = !active && (triggered || !message);
        const error = !triggerSpeaks && message?.kind === "error";
        return (
          <PreviewCardPopup
            popupClassName={
              error ? `${styles.message} ${styles.error}` : styles.message
            }
            anchor={anchor}
            side="bottom"
            align="end"
            sideOffset={centerOverAnchor}
            alignOffset={-2}
            collisionAvoidance={{
              side: "none",
              align: "none",
              fallbackAxisSide: "none",
            }}
          >
            {triggerSpeaks
              ? payload
              : message && (
                  <div role={error ? "alert" : "status"}>
                    {error && <WarningIcon />}
                    {message.content}
                  </div>
                )}
          </PreviewCardPopup>
        );
      }}
    </BasePreviewCard.Root>
  );
};

// An element (`render`, with `children` as its contents) that says `message`
// in the area while it is hovered or focused.
export const MessageTrigger = ({
  message,
  render,
  children,
}: {
  message: ReactNode;
  render: PreviewCardTriggerProps["render"];
  children: ReactNode;
}) => (
  <BasePreviewCard.Trigger
    handle={messageHandle}
    payload={message}
    delay={200}
    render={render}
  >
    {children}
  </BasePreviewCard.Trigger>
);

// A message in the area, from anywhere in the app: useMessage for markup. It
// is up while it is mounted, so render it for as long as what it says holds.
// It renders nothing where it stands.
export const Message = ({
  kind = "default",
  children,
}: {
  kind?: MessageKind;
  children: ReactNode;
}) => {
  useMessage(children, kind);
  return null;
};
