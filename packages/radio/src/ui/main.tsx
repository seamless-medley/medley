import React from 'react';
import ReactDOM from 'react-dom';

import { entangle } from './hashi/atoms';
import { atom, useAtom } from 'jotai';
import { Client } from './client';
import { Button, MantineProvider } from '@mantine/core';

const x = entangle(10);
const k = atom(10);

const App: React.FC = () => {
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
