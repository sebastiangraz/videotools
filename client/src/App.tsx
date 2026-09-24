import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  type RouterHistory,
} from "@tanstack/react-router";
import { Layout, ToolPage } from "./Layout";
import { SITE_PAGES, type SitePath } from "./pages/site";
import { TOOL_IDS, isToolId } from "../../shared/tools";

const rootRoute = createRootRoute({ component: Layout });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/$tool", params: { tool: TOOL_IDS[0] } });
  },
});

const toolRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/$tool",
  beforeLoad: ({ params }) => {
    if (!isToolId(params.tool)) {
      throw redirect({ to: "/$tool", params: { tool: TOOL_IDS[0] } });
    }
  },
  component: ToolPage,
});

// One route per one-off page (pages/site.ts); dev-only pages are left out of
// builds.
const siteRoutes = (Object.keys(SITE_PAGES) as SitePath[])
  .filter((path) => import.meta.env.DEV || !SITE_PAGES[path].devOnly)
  .map((path) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path,
      component: SITE_PAGES[path].component,
    }),
  );

const routeTree = rootRoute.addChildren([indexRoute, toolRoute, ...siteRoutes]);

// history is injectable so tests can use createMemoryHistory
export function createAppRouter(history?: RouterHistory) {
  return createRouter({ routeTree, history, defaultViewTransition: true });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
