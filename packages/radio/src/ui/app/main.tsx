import { Link, Outlet, RootRoute, Route, Router, RouterProvider } from "@tanstack/router";
import { MantineProvider } from '@mantine/core';

import { initRoot } from '../init';
import { Demo } from '../demo';

const rootRoute = new RootRoute({
  component: () => (
    <>
    <div>
      <Link to="/">Home</Link>
    </div>
    <div>
      <Link to="/demo">demo</Link>
    </div>
    <hr />
    <Outlet />
  </>
  )
});

const indexRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => (
    <div>
      <h3>Welcome Home!</h3>
    </div>
  )
});

const demoRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/demo',
  component: Demo
});

// Create the route tree using your routes
const routeTree = rootRoute.addChildren([
  indexRoute,
  demoRoute
]);

const router = new Router({ routeTree })

initRoot().render(
  // <React.StrictMode>
    <MantineProvider withGlobalStyles withNormalizeCSS withCSSVariables>
      <RouterProvider router={router} />
    </MantineProvider>
  // </React.StrictMode>
);
