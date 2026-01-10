import React, { useEffect, useRef } from "react";
import clsx from "clsx";
import { Link } from "@tanstack/react-router";
import { Box, Card, Flex, Image, Text } from "@mantine/core";
import { useElementSize, useMergedRef } from "@mantine/hooks";
import { transparentize } from "polished";
import { AnimatePresence, motion, MotionNodeOptions } from "motion/react";

import type { DeckIndex } from "@seamless-medley/medley";
import { useDeckCover, useDeckInfo } from "@ui/hooks/useDeck";
import { theme } from "@ui/theme";
import { AutoScroller } from "@ui/components/AutoScoller";
import { PlayHeadText } from "@ui/components/PlayHeadText";
import { DJConsoleRoute } from "../DJConsolePage/route";
import { CollectionRoute } from "../CollectionPage/route";
import classes from './PlayDeck.module.css';

export type PlayDeckProps = {
  stationId: string | undefined;
  index: DeckIndex;
}

const PlayHead: React.FC<PlayDeckProps> = ({ stationId, index }) => {
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
      const drawVertLine = (p: number) => ctx.fillRect(positionToX(p), 0, 1, h);

      ctx.clearRect(0, 0, w, h);

      ctx.fillStyle = 'rgb(0 0 0 / 15%)';
      ctx.fillRect(0, 0, w, h);

      if (first !== undefined && last !== undefined) {
        // ctx.fillStyle = 'rgb(0 0 0 / 33%)'
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
    <canvas ref={ref} width={elementSize.width} height={elementSize.height} style={{ width: '100%', height: '100%' }}>

    </canvas>
  )
}

export const PlayDeck: React.FC<PlayDeckProps> = ({ stationId, index }) => {
  const { active, trackPlay } = useDeckInfo(stationId, index, 'active', 'trackPlay');
  const cover = useDeckCover(stationId, index);

  const hasCover = (trackPlay?.track?.extra?.coverAndLyrics?.cover?.byteLength ?? 0) !== 0;

  const animatePresenceProps: MotionNodeOptions = {
    initial: { opacity: 0 },
    exit: { opacity: 0 },
    animate: { opacity: 1 },
    transition: { duration: 0.6, ease: 'easeInOut' }
  }

  return (
    <Card pos="relative" shadow="sm" m="sm" padding="lg" radius="md" withBorder>
      <Card.Section>
        <Text className={clsx(classes.header, trackPlay?.uuid && classes.loaded, active && classes.active)}>
          {index+1}
        </Text>

        <Box pos='relative' style={{ aspectRatio: 1 }}>
          <AnimatePresence>
            {hasCover &&
              <Image component={motion.img}
                key='cover'
                pos='absolute'
                h='100%'
                fit='cover'
                src={cover}
                fallbackSrc="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
                {...animatePresenceProps}
              />
            }

            {trackPlay && !hasCover &&
              <motion.div key="info" className={classes.coverInfo} {...animatePresenceProps}>
                <Text className={clsx(classes.deckInfo, classes.big)}>
                  {trackPlay?.track.extra?.tags?.title ?? 'Untitled'}
                </Text>
                <Text className={clsx(classes.deckInfo, classes.medium)}>
                  {trackPlay?.track.extra?.tags?.artist}
                </Text>
              </motion.div>
            }

            {!trackPlay &&
              <motion.div key="idle" className={clsx(classes.coverInfo, classes.idle)} {...animatePresenceProps}>
                <Text className={clsx(classes.deckInfo, classes.medium)}>
                  idle
                </Text>
              </motion.div>
            }
          </AnimatePresence>
        </Box>
      </Card.Section>

      <Card.Section>
        <Flex direction="column">
          <Box w="100%" h={24}>
            <PlayHead stationId={stationId} index={index} />
          </Box>

          <Flex direction="column" p={8}>
            <Flex justify="space-between">

                <div
                  style={{
                    fontSize: '1.1em',
                    width: "calc(100% - 11ch)",
                    height: '1.8em',
                    transform: 'translateY(-2px)',
                    textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}
                >
                  <AutoScroller>
                    {trackPlay?.track.extra?.tags?.title ?? trackPlay?.track?.path}
                  </AutoScroller>
                </div>

              <div>
                <PlayHeadText stationId={stationId ?? ''} deckIndex={index} />
              </div>
            </Flex>
            <Flex justify="space-between">
              <div
                style={{
                  fontSize: '0.9em',
                  height: '1.6em',
                  transform: 'translateY(-2px)',
                  textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}
              >
                <AutoScroller>
                  {trackPlay?.track.extra?.tags?.artist}
                </AutoScroller>
              </div>
            </Flex>
            <Flex justify="space-between" h="1em">
              {trackPlay?.track.collection?.id &&
                <Link
                  from={DJConsoleRoute.fullPath}
                  to={CollectionRoute.fullPath}
                  params={{ collectionId: trackPlay?.track.collection?.id }}
                  style={{
                    fontSize: '0.7em',
                    height: '1.55em',
                    transform: 'translateY(-2px)',
                    textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}
                >
                    {trackPlay?.track.collection?.description}
                </Link>
              }
            </Flex>
          </Flex>
        </Flex>
      </Card.Section>
    </Card>
  )
}
