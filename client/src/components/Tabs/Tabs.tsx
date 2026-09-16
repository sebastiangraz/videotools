import { forwardRef, type ReactNode } from "react";
import {
  Tabs as BaseTabs,
  type TabsRootProps,
  type TabsTabProps,
} from "@base-ui/react/tabs";
import styles from "./Tabs.module.css";

// Tab strip on Base UI's Tabs. Only the list is composed here; the caller owns
// what each tab reveals (here a route), so `value` is controlled and there are
// no panels. `className` goes on the Root, `listClassName` on the tablist.
// `indicatorClassName` adds a Tabs.Indicator that tracks the active tab: it is
// positioned and animated here, and the caller gives it its look.
export const Tabs = ({
  value,
  onValueChange,
  className,
  listClassName,
  indicatorClassName,
  children,
}: {
  value: TabsTabProps["value"];
  onValueChange?: TabsRootProps["onValueChange"];
  className?: string;
  listClassName?: string;
  indicatorClassName?: string;
  children: ReactNode;
}) => (
  <BaseTabs.Root
    value={value}
    onValueChange={onValueChange}
    className={className}
  >
    <BaseTabs.List
      className={listClassName ? `${styles.list} ${listClassName}` : styles.list}
    >
      {children}
      {indicatorClassName ? (
        <BaseTabs.Indicator
          className={`${styles.indicator} ${indicatorClassName}`}
        />
      ) : null}
    </BaseTabs.List>
  </BaseTabs.Root>
);

// A single tab. Forwards its ref and any extra props so it can itself be the
// `render` target of another Base UI part (a PreviewCard trigger, say). To
// render as a link pass `render={<Link />}` together with `nativeButton={false}`.
export const Tab = forwardRef<
  HTMLElement,
  Omit<TabsTabProps, "className"> & { className?: string }
>(({ className, ...props }, ref) => (
  <BaseTabs.Tab
    ref={ref}
    className={className ? `${styles.tab} ${className}` : styles.tab}
    {...props}
  />
));
Tab.displayName = "Tab";
