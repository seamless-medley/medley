import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/play/_play-layout")({
  component: () => {
    return (
      <>
        <Outlet />
      </>
    )
  }
})
