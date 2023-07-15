import { lazy, Route } from '@tanstack/router';
import { rootRoute } from '../_root';

export const route = new Route({
  getParentRoute: () => rootRoute,
  path: '/dj/$station',
  component: lazy(() => import('./view'))
});
