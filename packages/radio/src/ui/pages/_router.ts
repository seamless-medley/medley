import { rootRoute } from './_root';
import { route as demoRoute } from './dj/route';
import { route as indexRoute } from './home';
import { Router } from '@tanstack/router';

const routeTree = rootRoute.addChildren([
  indexRoute,
  demoRoute
]);

export const router = new Router({ routeTree })

declare module '@tanstack/router' {
  interface Register {
    router: typeof router
  }
}
