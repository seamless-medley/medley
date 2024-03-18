import { createRoute } from "@tanstack/react-router";
import { rootRoute } from './rootRoute';

export const route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => (
    <div>
      <h3>Welcome Home!</h3>
    </div>
  )
});
