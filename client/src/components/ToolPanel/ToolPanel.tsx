import { useRef, MouseEvent, ReactNode } from "react";
import { Tooltip } from "../Tooltip/Tooltip";
import { Footer } from "../Footer/Footer";
import { Spinner } from "../Spinner/Spinner";
import type { Tool } from "../../tools";
import type { ToolRun } from "../../hooks/useToolRun";
import styles from "./ToolPanel.module.css";

// The frame every tool page fills in: `inputs` (the drop zones) in the first
// container, then the page's options (`children`), the action and Stop
// buttons, the error box and the footer in the second. The options must
// land as direct children of their container — the tab-change transition
// staggers them by position (see the stylesheet) — so pages pass a fragment,
// not a wrapper.
// `blocker` says what is still missing before a run can start (it is the
// action button's tooltip); null = ready.
export const ToolPanel = ({
  tool,
  inputs,
  blocker,
  run,
  onSubmit,
  children,
}: {
  tool: Tool;
  inputs: ReactNode;
  blocker: string | null;
  run: ToolRun;
  onSubmit: () => void;
  children?: ReactNode;
}) => {
  const submitRef = useRef<HTMLButtonElement>(null);
  const { busy, status, errorDetail } = run;
  const ready = blocker === null;

  const submit = () => {
    // The button is only aria-disabled, so unusable states are rejected here
    // rather than by the browser
    if (!ready || busy) return;
    onSubmit();
  };

  // Stop hides itself the moment the run ends, which would drop keyboard
  // focus on <body>; hand it back to the action button instead.
  const stop = (e: MouseEvent<HTMLButtonElement>) => {
    run.stop();
    if (e.detail === 0) submitRef.current?.focus();
  };

  return (
    <>
      <div className={styles.container}>{inputs}</div>

      <div className={styles.container}>
        {children}

        <div className={styles.actions}>
          <Tooltip
            disabled={ready}
            content={blocker}
            render={
              <button
                ref={submitRef}
                onClick={submit}
                aria-disabled={!ready || busy}
                className={styles.button}
              />
            }
          >
            {busy ? status && status : tool.actionLabel}
            {busy && <Spinner className={styles.spinner} />}
          </Tooltip>

          <button
            type="button"
            onClick={stop}
            hidden={!busy}
            className={styles.stopButton}
          >
            Stop
          </button>
        </div>

        {errorDetail && (
          <div role="alert" className={styles.errorBox}>
            <details open>
              <summary className={styles.errorSummary}>
                <span>You broke it my dude.</span>
              </summary>
              <p className={styles.errorDetail}>{errorDetail}</p>
            </details>
          </div>
        )}

        <Footer />
      </div>
    </>
  );
};
