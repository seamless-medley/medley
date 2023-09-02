import { Route, lazy } from "@tanstack/router";
import { rootRoute } from "../_root";

export const route = new Route({
  getParentRoute: () => rootRoute,
  path: '/play/$station',
  component: lazy(() => import('./view'))
});
