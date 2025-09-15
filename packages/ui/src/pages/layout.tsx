import { AppShell } from '@mantine/core'
import { createFileRoute, Outlet } from '@tanstack/react-router'
import { NavBar } from './NavBar'

const Layout = () => {
  return (
    <AppShell header={{ height: 60 }}>
      <NavBar />
      <AppShell.Main p="md">
        <Outlet />
      </AppShell.Main>
    </AppShell>
  )
}

export const Route = createFileRoute('/_normal-layout')({
  component: Layout,
})
