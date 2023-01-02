import React from 'react';

import { initRoot } from './init';
import { Button, Group, MantineProvider } from '@mantine/core';
import { Tick } from '../socket/remote';
import { StubOf } from '../socket/stub';
import { Config } from '../socket/remote';
import { noop } from 'lodash';
import { useRemotable, useRemotableProp } from './hooks/remotable';
import { useSurrogate } from './hooks/surrogate';
import { Station } from '../socket/remote/station';

const StubConfig = StubOf<Config>(class Config {
  mongodb = undefined as any;
});

const StubTick = StubOf<Tick>(class Tick {
  count = undefined as any;
  test = noop as any;
});

const StubStation = StubOf<Station>(class Station {
  playing = undefined as any;
  paused = undefined as any;
  playState = undefined as any;

  start = noop as any;
  pause = noop as any;
  skip = noop as any;
});

const TickComponent: React.FC = () => {
  const tick = useSurrogate(StubTick, 'tick', '');
  const tickValues = useRemotable(tick);

  return (
    <div>
      Hello { tickValues?.count }
      <h4>Tick</h4>
      <pre>
        { JSON.stringify(tickValues) }
      </pre>
    </div>
  );
}

const ConfigComponent: React.FC = () => {
  const config = useSurrogate(StubConfig, 'config', '');
  const configValues = useRemotable(config);

  return (
    <>
      <h4>Config</h4>
      <pre>
        { JSON.stringify(configValues, undefined, 2) }
      </pre>
    </>
  );
}

const App: React.FC = () => {
  const tick = useSurrogate(StubTick, 'tick', '');
  const tick2 = useSurrogate(StubTick, 'tick', '');
  const count = useRemotableProp(tick, 'count');
  const count2 = useRemotableProp(tick2, 'count');

  const station = useSurrogate(StubStation, 'station', 'default');

  return (
    <>
      <TickComponent />
      <ConfigComponent />
      <div>{ count }</div>
      <div>{ count2 }</div>
      <Group>
        <Button disabled={!station} onClick={() => station?.start()}>Start</Button>
        <Button disabled={!station} onClick={() => station?.pause()}>Pause</Button>
        <Button disabled={!station} onClick={() => station?.skip()} color="red">Skip</Button>
      </Group>
    </>
  );
}

initRoot().render(
  // <React.StrictMode>
    <MantineProvider withGlobalStyles withNormalizeCSS withCSSVariables>
      <App />
    </MantineProvider>
  // </React.StrictMode>
);
