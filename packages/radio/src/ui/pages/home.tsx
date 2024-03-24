import { createRoute } from "@tanstack/react-router";
import { rootRoute } from './rootRoute';

export const route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => (
    <div>
      <div>

      </div>
    </div>
  )
});
