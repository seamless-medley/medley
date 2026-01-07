import { index, layout, rootRoute, route } from "@tanstack/virtual-file-routes";

export const routes = rootRoute('root.tsx', [
  layout('normal-layout', 'layout.tsx', [
    index('home/HomePage/route.tsx'),
    route('/play', [
      route('/$station', 'play/PlayPage/route.tsx')
    ]),
  ]),
  route('/dj', [
    layout('dj-layout', 'dj/layout.tsx', [
      route('/$station', [
        index('dj/DJConsolePage/route.tsx'),
        route('/collection/$collectionId', 'dj/CollectionPage/route.tsx')
      ])
    ])
  ])
]);
