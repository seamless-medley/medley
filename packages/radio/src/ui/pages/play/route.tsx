import { Route, lazyRouteComponent } from "@tanstack/react-router";
import { rootRoute } from "../_root";

export const route = new Route({
  getParentRoute: () => rootRoute,
  path: '/play/$station',
  component: lazyRouteComponent(() => import('./view'))
});
