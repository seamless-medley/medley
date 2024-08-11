import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { rootRoute } from "../rootRoute";

const route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/play/$station',
  component: lazyRouteComponent(() => import('./view'))
});

export const tree = route;
