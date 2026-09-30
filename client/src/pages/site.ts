import type { RouteComponent } from "@tanstack/react-router";
import { Test } from "./Test/Test";

// A static path wins over /$tool, so a page may not share a tool's path.
// devOnly pages fall through to /$tool (and redirect) in a build.
type SitePage = { component: RouteComponent; devOnly?: boolean };

const pages = {
  "/test": { component: Test, devOnly: true },
} satisfies Record<`/${string}`, SitePage>;

export type SitePath = keyof typeof pages;

export const SITE_PAGES: Record<SitePath, SitePage> = pages;
