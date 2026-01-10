import { DEFAULT_THEME, createTheme, mergeMantineTheme } from "@mantine/core";
import '@mantine/core/styles.css';
import '@mantine/carousel/styles.css';
import '@mantine/notifications/styles.css';
import 'mantine-contextmenu/styles.css';
import 'overlayscrollbars/overlayscrollbars.css';
import { fontFamily } from './fonts';
import classes from './global.module.css';

const primaryColor = 'pink';

export const themeOverride = createTheme({
  fontFamily,
  primaryColor,
  defaultGradient: {
    deg: 90,
    from: primaryColor,
    to: 'violet'
  }
});

export const theme = mergeMantineTheme(DEFAULT_THEME, themeOverride);

export const contextMenuClassNames = {
  root: classes.contextmenu
}
