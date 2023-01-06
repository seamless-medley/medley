import React, { useEffect, useRef } from 'react';
import styled from "@emotion/styled";

import { initRoot } from './init';
import { Button, Group, MantineProvider } from '@mantine/core';
import { StubOf } from '../socket/stub';
import { identity, mapValues, noop } from 'lodash';
import { useSurrogateWithRemotable } from './hooks/surrogate';
import { Station } from '../socket/remote/station';
import { Deck } from './components';
import { Remotable } from '../socket/types';
import type { StationAudioLevels } from '@seamless-medley/core';
import { gainToDecibels, interpolate } from '@seamless-medley/utils';

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

const emptyLevel: StationAudioLevels = {
  left: {
    magnitude: 0,
    peak: 0
  },
  right: {
    magnitude: 0,
    peak: 0
  },
  reduction: 0
}

function arrayBufferToAudioLevels(buffer?: ArrayBuffer): StationAudioLevels {
  if (!buffer || (buffer.byteLength < 8 * 5)) {
    return emptyLevel;
  }

  const view = new Float64Array(buffer);

  return {
    left: {
      magnitude: view[0],
      peak: view[1]
    },
    right: {
      magnitude: view[2],
      peak: view[3]
    },
    reduction: view[4]
  }
}

const Box = styled.div`
  width: 500px;
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
  right: 0;
  bottom: 0;
  background-color: rgba(77, 224, 66, 0.877);
`;

const Peak = styled.div`
  position: absolute;
  width: 2px;
  top: 0;
  bottom: 0;

  background-color: rgba(226, 28, 104, 0.902);
`;

const Reduction = styled.div`
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;

  background-color: rgba(97, 22, 236, 0.902);
`;


const VUMeter: React.FC<{ station?: Remotable<Station>, channel: 'left' | 'right' }> = ({ station, channel }) => {
  const levelRef = useRef<HTMLDivElement>(null);
  const reductionRef = useRef<HTMLDivElement>(null);
  const peakRef = useRef<HTMLDivElement>(null);

  let raf = 0;

  const normalize = (v: number, headRoom: number = 6) => interpolate(Math.min(v, headRoom), [-100, headRoom], [0, 1]);

  const handleAudioLevels: Station['ϟaudioLevels'] = (buffer) => {
    const { current: levelEl } = levelRef;
    const { current: reductionEl } = reductionRef;
    const { current: peakEl } = peakRef;

    if (!levelEl || !peakEl || !reductionEl) {
      return;
    }

    const levels = arrayBufferToAudioLevels(buffer);
    const { magnitude, peak } = mapValues({ ...levels[channel] }, gainToDecibels);

    raf = requestAnimationFrame(() => {
      // el.style.opacity = `${levels.left.magnitude*200}%`
      // el.innerText = `${normalize(magnitude).toFixed(2)}`;
      levelEl.style.right = `${(1-normalize(magnitude)) * 100}%`;
      peakEl.style.right = `${(1-normalize(peak)) * 100}%`;

      const reduction = normalize(levels.reduction + 6.0);

      reductionEl.style.left = `${(reduction) * 100}%`
      raf = 0;
    })
  }

  useEffect(() => {
    if (!station) {
      return;
    }

    station.on('audioLevels', handleAudioLevels);

    return () => {
      cancelAnimationFrame(raf);
      station.off('audioLevels', handleAudioLevels);
    }
  }, [station]);



  return (
    <div>
      <Box>
        &nbsp;

        <Level ref={levelRef} />
        <Reduction ref={reductionRef} />
        <Peak ref={peakRef}/>
      </Box>
    </div>
  );
}

const App: React.FC = () => {
  const [station, stationProps] = useSurrogateWithRemotable(StubStation, 'station', 'default');

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
