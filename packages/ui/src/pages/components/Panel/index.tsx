import { Panel as PanelInternal, PanelList } from './Panel';

const p = PanelInternal as typeof Panel;

p.List = PanelList;

export const Panel: (typeof PanelInternal) & {
  List: typeof PanelList;
} = p;
