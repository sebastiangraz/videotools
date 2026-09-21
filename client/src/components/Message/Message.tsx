import { ReactNode, useContext, useEffect } from "react";
import { createPortal } from "react-dom";
import { MessageContext } from "./messageHost";
import styles from "./Message.module.css";

// What a message is: `default` just says something, `error` names a problem
// the user has to fix and gets the warning mark in front.
export type MessageKind = "default" | "error";

// Placeholder until the real SVG lands.
const WarningIcon = () => (
  <span aria-hidden="true" className={styles.icon}>
    ⚠️
  </span>
);

// A message over the header's title (see messageHost.ts), from anywhere in
// the app. It is up while it is mounted, so render it for as long as what it
// says holds. It takes no space where it is rendered.
export const Message = ({
  kind = "default",
  children,
}: {
  kind?: MessageKind;
  children: ReactNode;
}) => {
  const host = useContext(MessageContext);
  if (!host) throw new Error("<Message> needs the layout's MessageContext");
  const { slot, register } = host;

  useEffect(() => register(), [register]);

  if (!slot) return null;
  return createPortal(
    <p
      role={kind === "error" ? "alert" : "status"}
      className={
        kind === "error" ? `${styles.message} ${styles.error}` : styles.message
      }
    >
      {kind === "error" && <WarningIcon />}
      {children}
    </p>,
    slot,
  );
};
