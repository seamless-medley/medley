import { index, layout, rootRoute, route } from "@tanstack/virtual-file-routes";

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
