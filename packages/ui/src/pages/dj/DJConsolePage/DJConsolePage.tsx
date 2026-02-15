import { Flex } from "@mantine/core";
import { PlayDeck, PlayDeckProps, PlayHead } from "@ui/pages/dj/components/PlayDeck";
import { useParams } from "@tanstack/react-router";
import { ResizablePanel } from "@ui/components/ResizablePanel";
import { Panel } from "@ui/pages/components/Panel";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { useDeckInfo } from "@ui/hooks/useDeck";
import classes from './DJConsolePage.module.css';

const DeckPanel: React.FC<PlayDeckProps> = ({ ...props }) => {
  const info = useDeckInfo(props.stationId, props.index, 'active', 'trackPlay');

  const state = info.active
    ? 'active'
    : info?.trackPlay?.uuid !== undefined
      ? 'loaded'
      : 'idle'

  const headerClass = {
    active: classes.activeDeck,
    loaded: classes.loadedDeck,
    idle: undefined
  }[state];

  return (
    <Panel
      h={150}
      mih={150}
      borders={{ bottom: true }}
      header={{
        caption: `Deck${props.index + 1}`,
        className: headerClass,
      }}
    >
      <PlayDeck
        {...props}
        controlComponent={<PlayHead stationId={props.stationId} index={props.index} />}
      />
    </Panel>
  )
}

const Decks = () => {
  const { station: stationId } = useParams({ strict: false });

  return (
    <OverlayScrollbarsComponent>
      <Flex className={classes.decks}>
        {[0, 1, 2].map((_, index) => (
          <DeckPanel
            key={index}
            stationId={stationId}
            index={index}
          />
        ))}
      </Flex>
    </OverlayScrollbarsComponent>
  )
}

export const DJConsolePage = () => {
  return (
    <Flex component="section" className={classes.djConsole}>
      <ResizablePanel.Group orientation='horizontal'>
        <ResizablePanel minSize={400} flexSize={0.3}>
          <Decks />
        </ResizablePanel>

        <ResizablePanel.Resizer />

        <ResizablePanel minSize={250} flexSize={0.5}>
          <Panel header='Requests' h={'100%'} orientation='vertical' />
        </ResizablePanel>

        <ResizablePanel.Resizer />

        <ResizablePanel minSize={250} flexSize={0.5}>
          <Panel header='Latches' h={'100%'} orientation='vertical' borders={{ right: true }} />
        </ResizablePanel>

        <ResizablePanel.Resizer />

        <ResizablePanel minSize={250} flexSize={0.5}>
          <Panel header='Listeners' h={'100%'} orientation='vertical' borders={{ right: true }} />
        </ResizablePanel>

      </ResizablePanel.Group>
    </Flex>
  )
}
