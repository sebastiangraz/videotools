import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  type RouterHistory,
} from "@tanstack/react-router";
import { Layout, ToolPage } from "./Layout";
import { SITE_PAGES, type SitePath } from "./pages/site";
import { toolById, type ToolId } from "./tools";
import { TOOL_IDS, isToolId } from "@videotools/core/formats";

const rootRoute = createRootRoute({
  head: () => ({ meta: [{ title: "videotoo.ls · Video tools in your browser" }] }),
  component: Layout,
});

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
  head: ({ params }) => {
    const { description } = toolById(params.tool as ToolId);
    return {
      meta: [
        { title: `${description} · videotoo.ls` },
        {
          name: "description",
          content: `${description} in your browser. Free, private and built on ffmpeg: files never leave your device.`,
        },
      ],
      links: [{ rel: "canonical", href: `https://videotoo.ls/${params.tool}` }],
    };
  },
  component: ToolPage,
});

const siteRoutes = (Object.keys(SITE_PAGES) as SitePath[]).map((path) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path,
    component: SITE_PAGES[path],
  }),
);

const routeTree = rootRoute.addChildren([indexRoute, toolRoute, ...siteRoutes]);

export function createAppRouter(history?: RouterHistory) {
  return createRouter({ routeTree, history, defaultViewTransition: true });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
