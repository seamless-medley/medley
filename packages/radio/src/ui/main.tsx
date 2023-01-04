import React, { useEffect, useState } from 'react';

import { initRoot } from './init';
import { Button, Group, MantineProvider } from '@mantine/core';
import { StubOf } from '../socket/stub';
import { noop } from 'lodash';
import { useSurrogateWithRemotable } from './hooks/surrogate';
import { Station } from '../socket/remote/station';
import { TrackPlay } from '../socket/po/track';

const StubStation = StubOf<Station>(class Station {
  playing = undefined as any;
  paused = undefined as any;
  playState = undefined as any;

  start = noop as any;
  pause = noop as any;
  skip = noop as any;
});

const App: React.FC = () => {
  const [trackPlay, setTrackPlay] = useState<TrackPlay | undefined>();
  const [coverURL, setCoverURL] = useState<string | undefined>();

  const [station, stationProps] = useSurrogateWithRemotable(StubStation, 'station', 'default');

  const handleTrackStarted = (deckIndex: number, trackPlay: TrackPlay) => {
    setTrackPlay(trackPlay);

    const cover = trackPlay.track.extra?.coverAndLyrics?.cover;
    const blob = new Blob(cover ? [cover] : []);
    setCoverURL(URL.createObjectURL(blob));
  }

  useEffect(() => {
    if (!station) {
      return;
    }

    station.on('trackStarted', handleTrackStarted);

    return () => {
      station.off('trackStarted', handleTrackStarted);
    }
  }, [station]);

  return (
    <>
      <Group>
        <Button disabled={!station} onClick={() => station?.start()}>Start</Button>
        <Button disabled={!station} onClick={() => station?.pause()}>Pause</Button>
        <Button disabled={!station} onClick={() => console.log('Skip', station?.skip())} color="red">Skip</Button>
      </Group>
      <h4>Play State: { stationProps?.playState }</h4>
      <img src={coverURL} />
      <pre>
        {JSON.stringify(trackPlay, undefined, 2)}
      </pre>
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
