import { HeadContent, Link, Outlet, useParams } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { PAGES } from "./pages";
import { ICONS, playIcons, type Icon } from "./icons";
import { TOOLS, type ToolId } from "./tools";
import { MessageArea, MessageTrigger } from "./components/Message/Message";
import { Tabs, Tab } from "./components/Tabs/Tabs";
import { Popover } from "./components/Popover/Popover";
import { ToggleGroup } from "./components/ToggleGroup/ToggleGroup";
import { useDebugMode } from "./hooks/useDebugMode";
import { CommandLine, VerboseNames } from "./hooks/useToolRun";
import { cx } from "./helpers";
import form from "./form.module.css";
import styles from "./Layout.module.css";

const THEME_OPTIONS = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const;

const VERBOSE_OPTIONS = [
  { value: "disabled", label: "Disabled" },
  { value: "enabled", label: "Enabled" },
] as const;

const COMMAND_LINE_OPTIONS = [
  { value: "hide", label: "Hide" },
  { value: "show", label: "Show" },
] as const;

// Persisted in localStorage; index.html also reads themeInvert before first paint.
const DEFAULT_SETTINGS = { verbose: false, commandLine: false, themeInvert: false };

// Stays mounted from tool to tool, so each icon morphs out of the last.
export const ToolIcon = ({ icon }: { icon: Icon }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const playerRef = useRef<ReturnType<typeof playIcons> | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    playerRef.current = playIcons(canvasRef.current!, () => setFailed(true));
    return playerRef.current.stop;
  }, []);
  useEffect(() => playerRef.current!.show(icon), [icon]);

  return failed ? null : (
    <div className={styles.icon}>
      <canvas ref={canvasRef} aria-hidden="true" />
    </div>
  );
};

export const Layout = () => {
  // Tab descriptions show in the title message area, not at the tab, so the
  // card never moves.
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const tabsRef = useRef<HTMLDivElement | null>(null);
  // Tabs are Links, so the URL drives the active tab (deep links, back/forward).
  const { tool } = useParams({ strict: false });
  // Keeps the debug-mode shortcut (Shift+D) listening on every page.
  const debug = useDebugMode();
  const [settings, setSettings] = useState<typeof DEFAULT_SETTINGS>(() => ({
    ...DEFAULT_SETTINGS,
    ...JSON.parse(localStorage.getItem("settings") ?? "{}"),
  }));
  useEffect(() => {
    localStorage.setItem("settings", JSON.stringify(settings));
    document.documentElement.toggleAttribute("data-theme-invert", settings.themeInvert);
  }, [settings]);
  const systemDark = matchMedia("(prefers-color-scheme: dark)").matches;
  const icon: Icon | undefined = ICONS[tool as ToolId];

  return (
    <div className={styles.app}>
      <HeadContent />
      <div className={styles.frame}>
        <header className={styles.header}>
          <div className={styles.logo}>
            <div className={styles.logoFill} />
          </div>
          <h1 ref={titleRef} className={styles.title}>
            videotoo.ls
            <span className={styles.debugLabel} data-on={debug || undefined} aria-hidden={!debug}>
              dev
            </span>
          </h1>
          <MessageArea anchor={titleRef} />
          {icon && <ToolIcon icon={icon} />}
        </header>

        <Tabs
          ref={tabsRef}
          value={tool ?? null}
          className={styles.tabContainer}
          listClassName={styles.tabs}
          indicatorClassName={styles.tabIndicator}
        >
          {TOOLS.map((t) => (
            <MessageTrigger
              key={t.value}
              excerpt={t.description}
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
          <Popover
            trigger={
              <button type="button" aria-label="Settings" className={styles.settingsTrigger}>
                <span aria-hidden="true" className={cx(form.label, styles.settingsLabel)}>
                  Settings
                </span>
                <svg aria-hidden="true" fill="none" viewBox="0 0 14 7">
                  <path stroke="currentColor" strokeWidth="1" d="M0 5.5h14M0 2h14" />
                </svg>
              </button>
            }
            anchor={tabsRef}
            sideOffset={0}
            className={styles.settings}
          >
            <div className={styles.settingsRow}>
              <span id="verbose" className={form.label}>
                Verbose file names
              </span>
              <ToggleGroup
                labelledBy="verbose"
                options={VERBOSE_OPTIONS}
                toggle
                value={settings.verbose ? "enabled" : "disabled"}
                onValueChange={(value) =>
                  setSettings({ ...settings, verbose: value === "enabled" })
                }
                disabled={false}
                size="small"
              />
            </div>
            <div className={styles.settingsRow}>
              <span id="commandLine" className={form.label}>
                Command line
              </span>
              <ToggleGroup
                labelledBy="commandLine"
                options={COMMAND_LINE_OPTIONS}
                toggle
                value={settings.commandLine ? "show" : "hide"}
                onValueChange={(value) =>
                  setSettings({ ...settings, commandLine: value === "show" })
                }
                disabled={false}
                size="small"
              />
            </div>
            <div className={styles.settingsRow}>
              <span id="theme" className={form.label}>
                UI Theme
              </span>
              <ToggleGroup
                labelledBy="theme"
                options={THEME_OPTIONS}
                toggle
                value={systemDark !== settings.themeInvert ? "dark" : "light"}
                onValueChange={(theme) =>
                  setSettings({ ...settings, themeInvert: (theme === "dark") !== systemDark })
                }
                disabled={false}
                size="small"
              />
            </div>
          </Popover>
        </Tabs>
        <main className={styles.main}>
          <VerboseNames value={settings.verbose}>
            <CommandLine value={settings.commandLine}>
              <Outlet />
            </CommandLine>
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
