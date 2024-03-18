import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { rootRoute } from "../rootRoute";

export const route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/play/$station',
  component: lazyRouteComponent(() => import('./view'))
});
