import { Box } from '@mantine/core'
import { createFileRoute, Outlet } from '@tanstack/react-router'
import { NavBar } from './components/NavBar'

const Layout = () => {

  return (
    <>
      <NavBar />
      <Box pt={80}>
        <Outlet />
      </Box>
    </>
  )
}

export const Route = createFileRoute('/_layout')({
  component: Layout,
})
