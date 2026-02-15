import React, { useEffect, useRef } from "react";
import clsx from "clsx";
import { Link } from "@tanstack/react-router";
import { Box, Flex, Image, Text } from "@mantine/core";
import { useElementSize, useMergedRef } from "@mantine/hooks";
import { transparentize } from "polished";
import { AnimatePresence, motion, MotionNodeOptions } from "motion/react";

import type { DeckIndex } from "@seamless-medley/medley";
import { useDeckCover, useDeckInfo } from "@ui/hooks/useDeck";
import { theme } from "@ui/theme";
import { PlayHeadText } from "@ui/components/PlayHeadText";
import fallbackImage from '@ui/fallback-image.svg?inline';
import { TransitionText } from "@ui/components/TransitionText";
import { DJConsoleRoute } from "../../DJConsolePage/route";
import { CollectionRoute } from "../../CollectionPage/route";
import classes from './PlayDeck.module.css';

export type PlayDeckProps = {
  stationId: string | undefined;
  index: DeckIndex;
  controlComponent?: React.ReactNode;
}

export const PlayHead: React.FC<PlayDeckProps> = ({ stationId, index }) => {
  const positions = useDeckInfo(stationId, index,
    'cp',
    'duration',
    'first',
    'last',
    'leading',
    'trailing',
    'cuePoint',
    'transitionStart',
    'transitionEnd'
  );

  const elementSize = useElementSize();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | undefined>(undefined);
  const ref = useMergedRef(elementSize.ref, canvasRef);
  const raf = useRef(0);

  useEffect(() => {
    ctxRef.current = canvasRef.current?.getContext('2d') ?? undefined;
  }, [canvasRef.current]);


    const ctx = ctxRef.current;

    if (ctx) {


      if (raf.current) {
        cancelAnimationFrame(raf.current);
      }

      raf.current = requestAnimationFrame(() => {
        const {
          cp: current,
          duration = 0,
          first,
          last,
          leading,
          trailing,
          cuePoint,
          transitionStart,
          transitionEnd
        } = positions;

        const { width: w, height: h } = ctx.canvas;

        const positionToX = (p: number) => p / duration * w;

        const drawRect = (p1: number, w: number) => ctx.fillRect(positionToX(p1), 0, positionToX(w), h);
        const drawVertLine = (p: number) => ctx.fillRect(positionToX(p), 0, 2, h);

        ctx.clearRect(0, 0, w, h);

        ctx.fillStyle = 'rgb(0 0 0 / 15%)';
        ctx.fillRect(0, 0, w, h);

        if (first !== undefined && last !== undefined) {
          ctx.fillStyle = transparentize(0.7, theme.colors.grape[8]);
          drawRect(0, first); // first audible
          drawRect(last, w); // last audible
        }

        if (last !== undefined && transitionEnd !== undefined) {
          ctx.fillStyle = transparentize(0.7, theme.colors.violet[9]);
          drawRect(transitionEnd, last - transitionEnd); // inaudible
        }

        if (first !== undefined && current !== undefined) {
          ctx.fillStyle = transparentize(0.25, theme.colors.green[4]);
          drawRect(first, current - first); // progress
        }

        if (cuePoint !== undefined) {
          ctx.fillStyle = theme.colors.blue[5];
          drawVertLine(cuePoint);
        }

        if (transitionStart !== undefined && transitionEnd !== undefined) {
          ctx.fillStyle = transparentize(0.4, theme.colors.pink[9]);
          drawRect(transitionStart, transitionEnd - transitionStart); // transition
        }

        if (leading !== undefined && leading > (first ?? 0)) {
          ctx.fillStyle = theme.colors.yellow[5];
          drawVertLine(leading);
        }

        if (trailing !== undefined) {
          ctx.fillStyle = theme.colors.orange[8];
          drawVertLine(trailing);
        }

        raf.current = 0;
      });
    }

  return (
    <canvas ref={ref} width={elementSize.width * 2} height={elementSize.height} style={{ width: '100%', height: '100%' }}>

    </canvas>
  )
}

export const PlayDeck: React.FC<PlayDeckProps> = React.memo(({ stationId, index, controlComponent }) => {
  const { trackPlay } = useDeckInfo(stationId, index, 'trackPlay');
  const { cover } = useDeckCover(stationId, index);

  const hasCover = (trackPlay?.track?.extra?.coverAndLyrics?.cover?.byteLength ?? 0) !== 0;

  const title = trackPlay?.track?.extra?.tags?.title;
  const artist = trackPlay?.track?.extra?.tags?.artist;

  const animatePresenceProps: MotionNodeOptions = {
    initial: { opacity: 0 },
    exit: { opacity: 0 },
    animate: { opacity: 1 },
    transition: { duration: 0.3, ease: 'easeInOut' }
  }

  return (
    <Flex className={classes.playdeck}>
      <Box component={motion.div} className={classes.coverBox}>
        <AnimatePresence mode='wait'>
          {hasCover &&
            <Image component={motion.img}
              key={'cover'}
              h='100%'
              fit='cover'
              src={cover}
              fallbackSrc={fallbackImage}
              {...animatePresenceProps}
            />
          }

          {trackPlay && !hasCover &&
            <motion.div key={'no_image'} className={classes.coverInfo} {...animatePresenceProps}>
              <Text className={clsx(classes.coverText)}>
                No Image
              </Text>
            </motion.div>
          }

          {!trackPlay &&
            <motion.div key={'idle'} className={classes.coverInfo} {...animatePresenceProps}>
              <Text className={clsx(classes.coverText)}>
                Idle
              </Text>
            </motion.div>
          }
        </AnimatePresence>
      </Box>
      <Flex className={classes.infoBox}>
        <Flex className={classes.info}>
          <TransitionText
            py={5}
            fw={600}
            size='1rem'
            h='1.3rem'
            transition={{ delay: 0.4 }}
            autoscroll
          >
            {title ?? trackPlay?.track?.path}
          </TransitionText>

          <TransitionText
            py={5}
            size="0.8rem"
            h='2rem'
            transition={{ delay: 0.5 }}
            autoscroll
          >
            {artist}
          </TransitionText>

          <Text className={classes.infoText}>
            {trackPlay?.track?.collection?.id &&
              <Link
                from={DJConsoleRoute.fullPath}
                to={CollectionRoute.fullPath}
                params={{ collectionId: trackPlay.track.collection.id }}>
                {trackPlay.track.collection.description}
              </Link>
            }
          </Text>

          <Text className={classes.infoText}>
            {trackPlay?.track?.sequencing &&
              <>
                Sequence: {trackPlay.track.sequencing.playOrder.join('/')}
                {trackPlay?.track?.sequencing?.latch &&
                  <span> (Latching {trackPlay.track.sequencing.latch.order.join('/')})</span>
                }
              </>
            }
          </Text>

        </Flex>

        <Flex className={classes.controlBox}>
            <Flex className={classes.control}>
              {controlComponent}
            </Flex>
            <Flex className={classes.playheadBox}>
              <PlayHeadText
                stationId={stationId}
                deckIndex={index}
                c="indigo.3"
                size="0.85rem"
              />
            </Flex>
        </Flex>
      </Flex>
    </Flex>
  )
});
