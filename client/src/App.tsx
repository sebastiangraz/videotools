import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  type RouterHistory,
} from "@tanstack/react-router";
import { Layout, ToolPage } from "./Layout";
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

const routeTree = rootRoute.addChildren([indexRoute, toolRoute]);

// history is injectable so tests can use createMemoryHistory
export function createAppRouter(history?: RouterHistory) {
  return createRouter({ routeTree, history, defaultViewTransition: true });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
