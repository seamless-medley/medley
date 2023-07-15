import { RouterProvider } from "@tanstack/router";
import { MantineProvider } from '@mantine/core';

import { initRoot } from '../init';
import { router } from "../pages/_router";

initRoot().render(
  // <React.StrictMode>
    <MantineProvider withGlobalStyles withNormalizeCSS withCSSVariables>
      <RouterProvider router={router} />
    </MantineProvider>
  // </React.StrictMode>
);
