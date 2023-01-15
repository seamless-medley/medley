import React, { useEffect, useRef } from 'react';
import styled from "@emotion/styled";

import { initRoot } from './init';
import { Button, Group, MantineProvider } from '@mantine/core';
import { StubOf } from '../socket/stub';
import { noop } from 'lodash';
import { useSurrogateWithRemotable } from './hooks/surrogate';
import { Collection, Station } from '../socket/remote';
import { Deck } from './components';
import { Remotable } from '../socket/types';
import { useAudioLevels } from './hooks/useAudioLevels';
import { useClient } from './hooks/useClient';


const Box = styled.div`
  width: 500px;
  height: 100%;
  position: relative;
  border-radius: 0.25em 0px 0px 0px;
  background-color: rgba(200, 200, 255, 0.3);
  transition: all 0.2s ease;
  white-space: nowrap;
  transition: width 2s ease, height 2s ease;
`;

const Level = styled.div`
  position: absolute;
  left: 0;
  top: 0;
  right: 100%;
  bottom: 0;
  background-color: rgba(77, 224, 66, 0.877);
`;

const Peak = styled.div`
  position: absolute;
  width: 2px;
  top: 0;
  bottom: 0;
  left: 0%;

  background-color: rgba(226, 28, 104, 0.902);
`;

const Reduction = styled.div`
  position: absolute;
  left: 100%;
  right: 0;
  top: 0;
  bottom: 0;

  background-color: rgba(97, 22, 236, 0.902);
`;


const VUMeter: React.FC<{ station?: Remotable<Station>, channel: 'left' | 'right' }> = ({ station, channel }) => {
  const levelRef = useRef<HTMLDivElement>(null);
  const reductionRef = useRef<HTMLDivElement>(null);
  const peakRef = useRef<HTMLDivElement>(null);

  useAudioLevels(station, (data) => {
    const { current: levelEl } = levelRef;
    const { current: reductionEl } = reductionRef;
    const { current: peakEl } = peakRef;

    if (!levelEl || !peakEl || !reductionEl) {
      return;
    }

    const { level, peak } = data[channel];

    levelEl.style.right = `${(1-level) * 100}%`;
    peakEl.style.left = `${(peak) * 100}%`;

    reductionEl.style.left = `${(data.reduction) * 100}%`
  });

  return (
    <div style={{ height: '24px' }}>
      <Box>
        <Level ref={levelRef} />
        <Reduction ref={reductionRef} />
        <Peak ref={peakRef}/>
      </Box>
    </div>
  );
}

const App: React.FC = () => {
  const client = useClient();
  const [station, stationProps] = useSurrogateWithRemotable(StubStation, 'station', 'demo');

  useEffect(() => {
    if (!station) {
      return;
    }

    station.getCollections().then(async cols => {
      console.log('Got collections');

      for (const col of cols) {
        const s = await client.surrogateOf(StubCollection, 'collection', `${station.id()}/${col}`);

        console.log('Options', s.options());

        // s.all().then((tracks) => {
        //   console.log('All tracks for', col, tracks);
        // })

        s.on('trackShift', (track) => {
          console.log('Track shift from', col, track);
        });

        s.on('trackPush', (track) => {
          console.log('Track push to', col, track);
        });
      }
    });
  }, [station])


  return (
    <>
      <div>
        Left: <VUMeter station={station} channel="left" />
      </div>
      <div>
        Right: <VUMeter station={station} channel="right" />
      </div>
      <br />
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
