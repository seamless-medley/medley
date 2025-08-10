// import { rootRoute } from './rootRoute';
// import { layoutRoute } from './layoutRoute';
// import { indexRoute } from './home';
// import { djRoute } from './dj/route';
// import { playRoute } from './play/route';
// import { createRouter } from '@tanstack/react-router';

import { index, layout, rootRoute, route } from "@tanstack/virtual-file-routes";

// const routeTree = rootRoute.addChildren([
//   layoutRoute.addChildren([
//     indexRoute
//   ]),
//   djRoute,
//   playRoute
// ]);

// export const router = createRouter({ routeTree });

export const routes = rootRoute('root.tsx', [
  index('home/HomePage/route.tsx'),
  route('/play', [
    layout('play-layout', 'play/layout.tsx', [
      route('$station', 'play/PlayPage/route.tsx')
    ])
  ]),
  route('/dj', [
    layout('dj-layout', 'dj/layout.tsx', [
      route('$station', 'dj/DJConsolePage/route.tsx')
    ])
  ])
])
