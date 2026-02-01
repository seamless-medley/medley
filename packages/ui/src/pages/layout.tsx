import { AppShell } from '@mantine/core'
import { createFileRoute, Outlet } from '@tanstack/react-router'
import { NavBar } from './NavBar'

const Layout = () => {
  return (
    <AppShell header={{ height: 60 }}>
      <AppShell.Header>
        <NavBar />
      </AppShell.Header>
      <AppShell.Main p="md" pt={70}>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  )
}

export const Route = createFileRoute('/_layout')({
  component: Layout,
})
