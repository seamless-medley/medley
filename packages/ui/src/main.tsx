import { createRouter, RouterProvider } from "@tanstack/react-router";
import { MantineProvider } from '@mantine/core';

import { routeTree } from "./pages/routeTree.gen";

import { initRoot } from './init';
// import { router } from "./pages/router";
import { theme } from "./theme/theme";
import { OverlayScrollbars } from "overlayscrollbars";

OverlayScrollbars(
  {
    target: document.body
  },
  {
    overflow: {
      x: 'hidden'
    },
    scrollbars: {
      autoHide: 'move'
    }
  }
);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

initRoot().render(
  // <React.StrictMode>
    <MantineProvider theme={theme} forceColorScheme="dark" classNamesPrefix="medley">
      <RouterProvider router={router} />
    </MantineProvider>
  // </React.StrictMode>
);
