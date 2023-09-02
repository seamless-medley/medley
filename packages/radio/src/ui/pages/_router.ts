import { rootRoute } from './_root';
import { route as indexRoute } from './home';
import { route as djRoute } from './dj/route';
import { route as playRoute } from './play/route';
import { Router } from '@tanstack/router';

const routeTree = rootRoute.addChildren([
  indexRoute,
  djRoute,
  playRoute
]);

export const router = new Router({ routeTree })

declare module '@tanstack/router' {
  interface Register {
    router: typeof router
  }
}
