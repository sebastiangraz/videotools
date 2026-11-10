import { MouseEvent, ReactNode } from "react";
import { Progress } from "@base-ui/react/progress";
import { Tooltip } from "@src/components/Tooltip/Tooltip";
import { Footer } from "@src/components/Footer/Footer";
import type { Tool } from "@src/tools";
import type { ToolRun } from "@src/hooks/useToolRun";
import styles from "./ToolPanel.module.css";

// The frame every tool page fills in: `inputs` (the drop zones) in the first
// container, then the page's options (`children`), the action row (the action
// button, which cancels a run in flight, on the left, `control` on the right),
// the error box and the footer in the second. The options must
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
  control,
  children,
}: {
  tool: Tool;
  inputs: ReactNode;
  blocker: string | null;
  run: ToolRun;
  onSubmit: () => void;
  control?: ReactNode;
  children?: ReactNode;
}) => {
  const { busy, progress, errorDetail } = run;
  const ready = blocker === null;

  // Busy, the button cancels the run; not on a double click's second click,
  // which would undo the first. It is only aria-disabled, so a run that
  // can't start yet is turned away here rather than by the browser.
  const click = (e: MouseEvent<HTMLButtonElement>) => {
    if (busy) {
      if (e.detail < 2) run.cancel();
    } else if (ready) {
      onSubmit();
    }
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
              <button onClick={click} aria-disabled={!ready && !busy} className={styles.submit} />
            }
          >
            <span className={styles.label}>{busy ? "Processing" : tool.actionLabel}</span>
            {busy && <span className={styles.cancel}>Cancel</span>}
            <Progress.Root value={progress} max={1} hidden={!busy} className={styles.progress}>
              <Progress.Indicator className={styles.indicator} />
            </Progress.Root>
          </Tooltip>
          {control}
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
