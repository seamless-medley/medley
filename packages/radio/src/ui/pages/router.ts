import { rootRoute } from './rootRoute';
import { indexRoute } from './home';
import { djRoute } from './dj/route';
import { playRoute } from './play/route';
import { createRouter } from '@tanstack/react-router';

const routeTree = rootRoute.addChildren([
  indexRoute,
  djRoute,
  playRoute
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
