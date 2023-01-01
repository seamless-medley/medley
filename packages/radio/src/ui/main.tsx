import React, { useEffect } from 'react';
import { createRoot, Root } from 'react-dom/client';

import { Client } from './client';
import { MantineProvider } from '@mantine/core';
import { RemoteTypes } from '../socket/remote';
import { StubOf } from '../socket/stub';
import { Config } from '../socket/remote';

const StubConfig = StubOf<Config>(class Config {
  mongodb = undefined as any;
  test = undefined as any;
});

const $window = window as any;
const client: Client<RemoteTypes> = $window.$client ?? (() => {
  const client = new Client<RemoteTypes>();

  // client.surrogateOf(StubConfig, 'config', '').then(async (config) => {
  //   const x = await config.mongodb();
  //   console.log('x', x);

  //   config.mongodb({
  //     ...x,
  //     url: 'GGGG'
  //   });

  //   config.dispose();
  // });

  client.remoteGet('config', '', 'mongodb').then(mongodb => console.log(mongodb));
  client.remoteInvoke('config', '', 'test', '')

  return client;
})();

const App: React.FC = () => {
  console.log('APP');

  return (
    <>
      Hello SSsss
    </>
  );
}

const root: Root = $window.$root ?? createRoot(document.getElementById('root') as HTMLElement);

root!.render(
  <React.StrictMode>
    <MantineProvider withGlobalStyles withNormalizeCSS withCSSVariables>
      <App />
    </MantineProvider>
  </React.StrictMode>
);

$window.$root = root;
$window.$client = client;
