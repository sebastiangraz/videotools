import { Link, Outlet, useParams } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { PAGES } from "./pages";
import { TOOLS, type ToolId } from "./tools";
import { MessageArea, MessageTrigger } from "./components/Message/Message";
import { Tabs, Tab } from "./components/Tabs/Tabs";
import { Popover } from "./components/Popover/Popover";
import { Switch } from "./components/Switch/Switch";
import { useDebugMode } from "./hooks/useDebugMode";
import { VerboseNames } from "./hooks/useToolRun";
import appStyles from "./index.module.css";
import form from "./pages/form.module.css";
import styles from "./Layout.module.css";

const Logo = () => (
  <div className={appStyles.logo}>
    <svg
      viewBox="0 0 176 111"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      preserveAspectRatio="xMidYMid meet"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M0 74V110.711L49.4873 61.2234C52.6123 58.0994 57.6768 58.0994 60.8018 61.2236L90.2881 90.7104C109.814 110.237 141.473 110.237 160.999 90.7104C180.524 71.1843 180.524 39.5261 160.999 20C141.473 0.473633 109.814 0.473633 90.2881 20L60.8018 49.4871C57.6768 52.6111 52.6123 52.6111 49.4873 49.4871L0 0V37L52.7051 54.5229C54.4668 55.1089 56.3789 55.0635 58.1113 54.3943L85.8447 43.6841C104.411 37.1582 134.511 37.1582 153.076 43.6841C171.642 50.2097 171.642 60.79 153.076 67.3159C134.511 73.8416 104.411 73.8416 85.8447 67.3159L58.1113 56.6055C56.3789 55.9365 54.4668 55.8911 52.7051 56.4771L0 74Z"
        fill="currentColor"
      />
    </svg>
  </div>
);

export const Layout = () => {
  // Tab descriptions show in the title message area, not at the tab, so the
  // card never moves.
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  // Tabs are Links, so the URL drives the active tab (deep links, back/forward).
  const { tool } = useParams({ strict: false });
  // Keeps the debug-mode shortcut (Shift+D) listening on every page.
  const debug = useDebugMode();
  const [verbose, setVerbose] = useState(false);

  return (
    <div className={appStyles.app}>
      <div className={appStyles.frame}>
        <header className={appStyles.header}>
          <Logo />
          <h1 ref={titleRef} className={appStyles.title}>
            Video tools
            <span className={styles.debugLabel} data-on={debug || undefined} aria-hidden={!debug}>
              dev
            </span>
          </h1>
          <MessageArea anchor={titleRef} />
        </header>

        <Tabs
          value={tool ?? null}
          className={styles.tabContainer}
          listClassName={styles.tabs}
          indicatorClassName={styles.tabIndicator}
        >
          {TOOLS.map((t) => (
            <MessageTrigger
              key={t.value}
              message={t.description}
              render={
                <Tab
                  value={t.value}
                  nativeButton={false}
                  className={styles.tab}
                  render={<Link to="/$tool" params={{ tool: t.value }} />}
                />
              }
            >
              {t.label}
            </MessageTrigger>
          ))}
          {/* Global settings. */}
          <Popover
            trigger={
              <button type="button" aria-label="Settings" className={styles.settingsTrigger}>
                <svg aria-hidden="true" fill="none" viewBox="0 0 7 7">
                  <path stroke="currentColor" strokeWidth="1.25" d="M0 5.5h7M0 2h7" />
                </svg>
              </button>
            }
            align="end"
            sideOffset={0}
            className={styles.settings}
          >
            <label htmlFor="verbose" className={`${form.label} ${styles.settingsLabel}`}>
              Settings
            </label>
            <div className={form.switchRow}>
              <Switch
                id="verbose"
                checked={verbose}
                onCheckedChange={setVerbose}
                disabled={false}
              />
              <label htmlFor="verbose" className={form.label}>
                Verbose file names
              </label>
            </div>
          </Popover>
        </Tabs>
        <main className={appStyles.main}>
          <VerboseNames value={verbose}>
            <Outlet />
          </VerboseNames>
        </main>
      </div>
    </div>
  );
};

export const ToolPage = () => {
  // A tab change unmounts the old page, and all its state goes with it.
  const { tool } = useParams({ from: "/$tool" });
  const Page = PAGES[tool as ToolId];
  return <Page />;
};
