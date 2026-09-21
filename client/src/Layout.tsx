import { Link, Outlet, useParams } from "@tanstack/react-router";
import { useRef } from "react";
import { PAGES } from "./pages";
import { TOOLS, type ToolId } from "./tools";
import { MessageArea, MessageTrigger } from "./components/Message/Message";
import { Tabs, Tab } from "./components/Tabs/Tabs";
import appStyles from "./index.module.css";
import styles from "./Layout.module.css";

const Logo = () => {
  return (
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
};

export const Layout = () => {
  // The title anchors the app's message area (components/Message). The tabs'
  // descriptions show there rather than at their own tab, so the card never
  // moves regardless of which tab is hovered, and so does any <Message>.
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  // The route is the source of truth for the active tab: each tab is a Link,
  // so clicking navigates and the strip follows the URL (deep links, back and
  // forward included). Before the index redirect lands no tab is active.
  const { tool } = useParams({ strict: false });

  return (
    <div className={appStyles.app}>
      <header className={appStyles.header}>
        <Logo />
        <h1 ref={titleRef} className={appStyles.title}>
          Video tools
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
      </Tabs>
      <main className={appStyles.main}>
        <Outlet />
      </main>
    </div>
  );
};

export const ToolPage = () => {
  // The route only lets known tools through (see beforeLoad in App.tsx).
  // Every tool is its own component, so a tab change unmounts the old page
  // and all of its state — picked files included — goes with it.
  const { tool } = useParams({ from: "/$tool" });
  const Page = PAGES[tool as ToolId];
  return <Page />;
};
