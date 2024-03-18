import { Outlet, createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { rootRoute } from '../rootRoute';

export const djRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dj/$station',
  component: lazyRouteComponent(() => import('./view'))
});
