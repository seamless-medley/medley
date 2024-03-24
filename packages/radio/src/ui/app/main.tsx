import { RouterProvider } from "@tanstack/react-router";
import { MantineProvider } from '@mantine/core';

import { initRoot } from '../init';
import { router } from "../pages/router";
import { theme } from "../theme/theme";
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

initRoot().render(
  // <React.StrictMode>
    <MantineProvider theme={theme} forceColorScheme="dark" classNamesPrefix="medley">
      <RouterProvider router={router} />
    </MantineProvider>
  // </React.StrictMode>
);
