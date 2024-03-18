import { RouterProvider } from "@tanstack/react-router";
import { MantineProvider } from '@mantine/core';

import { initRoot } from '../init';
import { router } from "../pages/_router";
import { theme } from "../theme/theme";

initRoot().render(
  // <React.StrictMode>
    <MantineProvider theme={theme} forceColorScheme="dark" classNamesPrefix="medley">
      <RouterProvider router={router} />
    </MantineProvider>
  // </React.StrictMode>
);
