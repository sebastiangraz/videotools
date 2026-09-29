import type { RouteComponent } from "@tanstack/react-router";
import { Test } from "./Test/Test";

// One-off pages outside the tool tabs (privacy, terms, ...), by path. Each
// gets its own route in App.tsx; a static path wins over the tools' /$tool,
// so a page may not share a path with a tool. `devOnly` pages are only routed
// by the dev server; in a build their path falls through to /$tool and
// redirects like any unknown one. Pages render their content in
// components/Page.
export type SitePage = { component: RouteComponent; devOnly?: boolean };

const pages = {
  "/test": { component: Test, devOnly: true },
} satisfies Record<`/${string}`, SitePage>;

export type SitePath = keyof typeof pages;

export const SITE_PAGES: Record<SitePath, SitePage> = pages;
