import { QueryClient } from "@tanstack/react-query";
import { createHashHistory, createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

/**
 * Hash history keeps client routing working when the built app is loaded
 * from a `file://` URL inside Electron.
 */
export const getRouter = () => {
  const queryClient = new QueryClient();

  return createRouter({
    routeTree,
    history: createHashHistory(),
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });
};
