import React from 'react';

import { initRoot } from './init';
import { Button, Group, MantineProvider } from '@mantine/core';
import { StubOf } from '../socket/stub';
import { noop } from 'lodash';
import { useSurrogateWithRemotable } from './hooks/surrogate';
import { Station } from '../socket/remote/station';
import { Deck } from './components';

const StubStation = StubOf<Station>(class Station {
  id = undefined as any;
  name = undefined as any;
  description = undefined as any;
  playing = undefined as any;
  paused = undefined as any;
  playState = undefined as any;

  start = noop as any;
  pause = noop as any;
  skip = noop as any;
  getDeckPositions = noop as any;
  getDeckInfo = noop as any;
});

const App: React.FC = () => {
  const [station, stationProps] = useSurrogateWithRemotable(StubStation, 'station', 'default');

  return (
    <>
      <Group>
        <Button disabled={!station} onClick={() => station?.start()}>Start</Button>
        <Button disabled={!station} onClick={() => station?.pause()}>Pause</Button>
        <Button disabled={!station} onClick={() => console.log('Skip', station?.skip())} color="red">Skip</Button>
      </Group>
      <h4>Play State: { stationProps?.playState }</h4>

      <h2>Deck1</h2>
      <Deck station={station} index={0} />

      <h2>Deck2</h2>
      <Deck station={station} index={1} />

      <h2>Deck3</h2>
      <Deck station={station} index={2} />
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
