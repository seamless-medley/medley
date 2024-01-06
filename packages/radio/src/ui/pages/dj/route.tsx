import { lazyRouteComponent, Route } from '@tanstack/react-router';
import { rootRoute } from '../_root';

export const route = new Route({
  getParentRoute: () => rootRoute,
  path: '/dj/$station',
  component: lazyRouteComponent(() => import('./view'))
});
