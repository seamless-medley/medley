import { DEFAULT_THEME, createTheme, mergeMantineTheme } from "@mantine/core";
import '@mantine/core/styles.css';
import '@mantine/carousel/styles.css';
import '@mantine/notifications/styles.css';
import 'mantine-contextmenu/styles.css';
import 'overlayscrollbars/overlayscrollbars.css';
import { fontFamily } from './fonts';
import classes from './global.module.css';

const primaryColor = 'blue';

export const themeOverride = createTheme({
  fontFamily,
  primaryColor,
  colors: {
    dark: [
      'hsl(205, 10%, 88.8%)',
      'hsl(205, 10%, 70.15%)',
      'hsl(205, 10%, 48.98%)',
      'hsl(205, 10%, 39.18%)',
      'hsl(205, 10%, 23.87%)',
      'hsl(205, 10%, 21.13%)',
      'hsl(205, 10%, 16.04%)',
      'hsl(205, 10%, 12.12%)',
      'hsl(205, 10%, 10.16%)',
      'hsl(205, 10%, 4.88%)'
    ]
  },
  defaultGradient: {
    deg: 90,
    from: primaryColor,
    to: 'grape'
  }
});

export const theme = mergeMantineTheme(DEFAULT_THEME, themeOverride);

export const contextMenuClassNames = {
  root: classes.contextmenu
}
