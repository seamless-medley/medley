import { Link, Outlet, RootRoute } from "@tanstack/router";

export const rootRoute = new RootRoute({
  component: () => (
    <>
    <div>
      <Link to="/">Home</Link>
    </div>
    <div>
      <Link to="/dj/$station" params={{ station: "demo" }}>demo</Link>
    </div>
    <hr />
    <Outlet />
  </>
  )
});
