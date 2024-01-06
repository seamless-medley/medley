import { RouterProvider } from "@tanstack/react-router";
import { MantineProvider } from '@mantine/core';
import '@mantine/core/styles.css';

import { initRoot } from '../init';
import { router } from "../pages/_router";

initRoot().render(
  // <React.StrictMode>
    <MantineProvider withCssVariables>
      <RouterProvider router={router} />
    </MantineProvider>
  // </React.StrictMode>
);
