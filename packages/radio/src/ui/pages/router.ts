import { rootRoute } from './rootRoute';
import { route as indexRoute } from './home';
import { djRoute as djRoute } from './dj/route';
import { route as playRoute } from './play/route';
import { createRouter } from '@tanstack/react-router';

const routeTree = rootRoute.addChildren([
  indexRoute,
  djRoute,
  playRoute
]);

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
