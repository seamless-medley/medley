import { createRouter, RouterProvider } from "@tanstack/react-router";
import { MantineProvider } from '@mantine/core';
import { OverlayScrollbars } from "overlayscrollbars";
import { ContextMenuProvider } from "mantine-contextmenu";
import { getLogger } from "@logtape/logtape";

import { routeTree } from "./pages/routeTree.gen";

import { initLogging, initRoot } from './init';
import { theme } from "./theme/theme";

const main = async () => {
  await initLogging();

  const logger = getLogger('main');

  logger.info(`Main start, version ${__UI_VERSION__}`);

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
      },
      update: {
        debounce: 800
      }
    }
  );

  const router = createRouter({ routeTree });

  initRoot().render(
    // <React.StrictMode>
      <MantineProvider theme={theme} forceColorScheme="dark" classNamesPrefix="medley">
        <ContextMenuProvider shadow="sm" borderRadius="md" repositionOnRepeat>
          <RouterProvider router={router} />
        </ContextMenuProvider>
      </MantineProvider>
    // </React.StrictMode>
  );

  return router;
}

main();

declare module '@tanstack/react-router' {
  interface Register {
    router: Awaited<ReturnType<typeof main>>
  }
}


