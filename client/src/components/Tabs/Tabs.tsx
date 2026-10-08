import type { ReactNode, Ref } from "react";
import { Tabs as BaseTabs, type TabsRootProps, type TabsTabProps } from "@base-ui/react/tabs";
import styles from "./Tabs.module.css";

// Tab strip on Base UI's Tabs. Only the list is composed here; the caller owns
// what each tab reveals (here a route), so `value` is controlled and there are
// no panels. `className` goes on the Root, `listClassName` on the tablist.
// `indicatorClassName` adds a Tabs.Indicator that tracks the active tab: it is
// positioned and animated here, and the caller gives it its look. `ref` lands
// on the Root.
export const Tabs = ({
  value,
  onValueChange,
  className,
  listClassName,
  indicatorClassName,
  ref,
  children,
}: {
  value: TabsTabProps["value"];
  onValueChange?: TabsRootProps["onValueChange"];
  className?: string;
  listClassName?: string;
  indicatorClassName?: string;
  ref?: Ref<HTMLDivElement>;
  children: ReactNode;
}) => (
  <BaseTabs.Root ref={ref} value={value} onValueChange={onValueChange} className={className}>
    <BaseTabs.List className={listClassName ? `${styles.list} ${listClassName}` : styles.list}>
      {children}
      {indicatorClassName ? (
        <BaseTabs.Indicator className={`${styles.indicator} ${indicatorClassName}`} />
      ) : null}
    </BaseTabs.List>
  </BaseTabs.Root>
);

// A single tab. Passes on its ref and any extra props so it can itself be the
// `render` target of another Base UI part (a PreviewCard trigger, say). To
// render as a link pass `render={<Link />}` together with `nativeButton={false}`.
export const Tab = ({
  className,
  ref,
  ...props
}: Omit<TabsTabProps, "className" | "ref"> & {
  className?: string;
  ref?: Ref<HTMLElement>;
}) => (
  <BaseTabs.Tab
    ref={ref}
    className={className ? `${styles.tab} ${className}` : styles.tab}
    {...props}
  />
);
