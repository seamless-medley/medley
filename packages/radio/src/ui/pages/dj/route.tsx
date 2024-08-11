import { Outlet, createRoute, lazyRouteComponent, notFound, useRouter } from '@tanstack/react-router';
import { rootRoute } from '../rootRoute';
import { AppShell, Box } from '@mantine/core';
import { client } from '../../init';

const route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dj',
  component: () => {
    const r = useRouter();
    const notFoundMatch = r.state.matches.find(({ error }) => (error as any)?.isNotFound);

    return (
      <AppShell
        header={{ height: 60 }}
        navbar={!notFoundMatch ? {
          width: 200,
          breakpoint: 20,
          collapsed: {
            mobile: false,
            desktop: false
          },
        } : undefined}
      >
        <AppShell.Header>
          Header
        </AppShell.Header>

        <Outlet />
      </AppShell>
    );
  }
});

export const stationRoute = createRoute({
  getParentRoute: () => route,
  path: '$station',
  loader: async ({ params }) => {
    const x = await client.remoteGet('station', params.station, 0, 'id').catch(() => notFound());
    console.log(x);
    return x;
  },
  notFoundComponent: () => {
    return (
      <AppShell.Main>
        No Such Station
      </AppShell.Main>
    )
  },
  component: lazyRouteComponent(() => import('./station'))
});

export const stationIndexRoute = createRoute({
  getParentRoute: () => stationRoute,
  path: '/',
  component: lazyRouteComponent(() => import('./index'))
});

export const collectionRoute = createRoute({
  getParentRoute: () => stationRoute,
  path: 'collection/$collectionId',
  component: lazyRouteComponent(() => import('./collection'))
});

export const tree = route.addChildren([
  stationRoute,
  stationIndexRoute,
  collectionRoute
])
