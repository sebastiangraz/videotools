import type { RouteComponent } from "@tanstack/react-router";
import { Components } from "./Components/Components";

// A static path wins over /$tool, so a page may not share a tool's path.
const pages = {
  "/components": Components,
} satisfies Record<`/${string}`, RouteComponent>;

export type SitePath = keyof typeof pages;

export const SITE_PAGES: Record<SitePath, RouteComponent> = pages;
