import { AppShell, Box, Burger, Group, NavLink } from '@mantine/core'
import { createFileRoute, Outlet, useParams, useRouter } from '@tanstack/react-router'
import { OverlayScrollbarsComponent } from 'overlayscrollbars-react';
import { TopBar } from './components/TopBar';

const Layout = () => {
  const params = useParams({ strict: false });

  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{
        width: 200,
        breakpoint: 20,
        collapsed: {
          mobile: false,
          desktop: false
        },
      }}
    >
      <AppShell.Header>
        Nav
      </AppShell.Header>

      <AppShell.Navbar p="sm" style={{ overflow: 'hidden', textWrap: 'wrap', wordBreak: 'break-word' }}>
        <OverlayScrollbarsComponent>
          Sidebar
          {/* <NavLink
            active={matchRoute({ to: stationIndexRoute.to }) !== false}
            component={Link}
            to={stationIndexRoute.to}
            label="Station"
          /> */}

          {/* <NavLink label="Collections" defaultOpened={collectionId !== undefined}> */}
            {/* TODO: Elipsis, nowrap */}
            {/* {collections.map(({ id, description }) => (
                <NavLink
                  key={id}
                  component={Link}
                  label={description}
                  c={currentCollection === id ? 'green.5' : undefined}
                  fw={currentCollection === id ? 'bold' : undefined}
                  style={{ transition: 'all 1s ease' }}
                  active={collectionId === id}
                  from={stationRoute.id}
                  to={collectionRoute.to}
                  params={{ collectionId: id } as any}
                />
            ))}
          </NavLink> */}
        </OverlayScrollbarsComponent>
      </AppShell.Navbar>

      <AppShell.Main>
        <Box style={{ position: 'sticky', top: 60, height: 200, zIndex: 100 }} >
          <TopBar stationId={params.station || ''} />
        </Box>

        <Outlet />
      </AppShell.Main>

    </AppShell>
  )
}

export const Route = createFileRoute('/dj/_dj-layout')({
  component: Layout
})
