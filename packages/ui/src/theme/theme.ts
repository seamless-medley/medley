import { DEFAULT_THEME, createTheme, mergeMantineTheme } from "@mantine/core";
import '@mantine/core/styles.css';
import '@mantine/carousel/styles.css';
import 'overlayscrollbars/overlayscrollbars.css';
import { fontFamily } from './fonts';

export const themeOverride = createTheme({
  fontFamily
});

export const theme = mergeMantineTheme(DEFAULT_THEME, themeOverride);
