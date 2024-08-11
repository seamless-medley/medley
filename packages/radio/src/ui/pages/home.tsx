import { createRoute } from "@tanstack/react-router";
import { rootRoute } from './rootRoute';

const route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => (
    <div>
      <div>

      </div>
    </div>
  )
});

export const tree = route;
