import { Route } from "@tanstack/router";

import { rootRoute } from './_root';

export const route = new Route({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => (
    <div>
      <h3>Welcome Home!</h3>
    </div>
  )
});
