import { Panel as PanelInternal } from './Panel/Panel';
import { PanelGroup } from './PanelGroup/PanelGroup';
import { Resizer } from './Resizer/Resizer';

const p = PanelInternal as any;

p.Group = PanelGroup;
p.Resizer = Resizer;

export const ResizablePanel: (typeof PanelInternal) & {
  Group: typeof PanelGroup;
  Resizer: typeof Resizer;
} = p;
