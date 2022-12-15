import React, { useEffect } from 'react';
import ReactDOM from 'react-dom';

import { entangle } from './hashi/atoms';
import { atom, useAtom } from 'jotai';
import { Client } from './client';
import { MantineProvider } from '@mantine/core';
import { RemoteTypes, StubCounter } from '../socket/remote';
import { range } from 'lodash';

const x = entangle(10);
const k = atom(10);

const App: React.FC = () => {
  useEffect(() => {
    const c = new Client<RemoteTypes>();

    Promise.all(range(0, 10).map(() => c.surrogateOf(StubCounter, 'root', 'test'))).then(surogates => {
      surogates.map((s, index) => {

        s.onPropertyChange('count', (newValue) => {
          console.log(`onPropertyChange count`, s, newValue);
        });
      });
    });

    return () => {
      c.dispose();
    }
  }, []);


  const [value, setValue] = useAtom(x);

  return (
    <>
      <span onClick={() => setValue(value + 1)}>Medley {value}</span>
    </>
  );
}

ReactDOM.render(
  <React.StrictMode>
    <MantineProvider withGlobalStyles withNormalizeCSS withCSSVariables>
      <App />
    </MantineProvider>
  </React.StrictMode>,
  document.getElementById('root')
);
