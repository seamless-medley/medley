import React, { useEffect, useRef } from "react";
import type { DeckIndex, DeckPositions } from "@seamless-medley/core";
import { useDeckInfo } from "../hooks/useDeck";
import { Box, Image, Text } from "@mantine/core";
import { useElementSize, useMergedRef } from "@mantine/hooks";
import { formatDuration } from "../utils/utils";

export type PlayDeckProps = {
  stationId: string | undefined;
  index: DeckIndex;
}

const CanvasPlayHead: React.FC<DeckPositions> = (positions) => {
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
      const { duration, current, first, last, leading, trailing, cuePoint, transitionStart, transitionEnd } = positions;

      const { width: w, height: h } = ctx.canvas;

      const positionToX = (p: number) => p / (duration ?? 0) * w;

      const drawRect = (p1: number, w: number) => ctx.fillRect(positionToX(p1), 0, positionToX(w), h);
      const drawVertLine = (p: number) => ctx.fillRect(positionToX(p), 0, 1, h);

      ctx.clearRect(0, 0, w, h);

      if (first !== undefined && last !== undefined) {
        ctx.fillStyle = 'rgb(0 0 0 / 33%)'
        drawRect(0, first); // first audible
        drawRect(last, w); // last audible
      }

      if (last !== undefined && transitionEnd !== undefined) {
        ctx.fillStyle = 'rgb(0 0 0 / 88%)'
        drawRect(transitionEnd, last - transitionEnd); // inaudible
      }

      if (first !== undefined && current !== undefined) {
        ctx.fillStyle = "rgb(0 255 0 / 75%)";
        drawRect(first, current - first); // progress
      }

      if (cuePoint !== undefined) {
        ctx.fillStyle = 'blue';
        drawVertLine(cuePoint);
      }

      if (transitionStart !== undefined && transitionEnd !== undefined) {
        ctx.fillStyle = 'rgb(255 88 100 / 60%)';
        drawRect(transitionStart, transitionEnd - transitionStart); // transition
      }

      if (leading !== undefined) {
        ctx.fillStyle = 'palevioletred';
        drawVertLine(leading);
      }

      if (trailing !== undefined) {
        ctx.fillStyle = 'orangered';
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
  const { info, cover } = useDeckInfo(stationId, index);

  return (
    <>
      <Box style={{ height: 440, width: '100%', border: '1px solid green' }}>
        <h2>Deck{index+1}</h2>
        <div>{formatDuration(info.cp, { withMs: true})} / {formatDuration(info.duration ?? 0, { withMs: true })}</div>
        { cover
          ? <Image
            src={cover}
            fit='contain'
            radius='md'
            height={300}
            />
          : <Text>No Image</Text>
        }
      </Box>

      <Box style={{ border: '1px solid blue', height: '24px' }}>
        <CanvasPlayHead current={info.cp} { ...info } />
      </Box>
      <ul>
        <li>{info?.trackPlay?.track.extra?.tags?.artist}</li>
        <li>{info?.trackPlay?.track.extra?.tags?.title}</li>
      </ul>
    </>
  )
}
