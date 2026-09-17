import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  type RouterHistory,
} from "@tanstack/react-router";
import { Layout, ToolPage } from "./Layout";
import { TOOLS } from "./tools";

const rootRoute = createRootRoute({ component: Layout });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/$tool", params: { tool: TOOLS[0].value } });
  },
});

const toolRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/$tool",
  beforeLoad: ({ params }) => {
    if (!TOOLS.some((t) => t.value === params.tool)) {
      throw redirect({ to: "/$tool", params: { tool: TOOLS[0].value } });
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
