import { Outlet, RootRoute } from "@tanstack/router";

export const rootRoute = new RootRoute({
  component: () => (
    <>
      <Outlet />
    </>
  )
});
