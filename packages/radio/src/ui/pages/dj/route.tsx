import { Outlet, createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { rootRoute } from '../rootRoute';
import { AppShell, Box } from '@mantine/core';
import { TopBar } from './top';

export const djRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dj',
  component: () => {
    return (
      <AppShell
        header={{ height: 60 }}
        navbar={{
          width: 100,
          breakpoint: 20,
          collapsed: {
            mobile: false,
            desktop: false
          },
        }}
      >
        <AppShell.Header>
          Header
        </AppShell.Header>

        <div>
          <AppShell.Navbar p="sm">
            Navbar
          </AppShell.Navbar>

          <AppShell.Main>
            <Outlet />
          </AppShell.Main>
        </div>
      </AppShell>
    );
  }
});

export const stationRoute = createRoute({
  getParentRoute: () => djRoute,
  path: '$station',
  component: lazyRouteComponent(() => import('./station'))
});

djRoute.addChildren([
  stationRoute
])
