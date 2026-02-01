import { Box } from '@mantine/core'
import { createFileRoute, Outlet } from '@tanstack/react-router'
import { NavBar } from './components/NavBar'

const Layout = () => {

  return (
    <Box>
      <NavBar />
      <Box pt='var(--navbar-height)'>
        <Outlet />
      </Box>
    </Box>
  )
}

export const Route = createFileRoute('/_layout')({
  component: Layout,
})
