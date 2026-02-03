import React, { useCallback, useEffect, useRef } from "react";
import { Box, Flex, FlexProps, MantineSpacing, MantineStyleProps } from "@mantine/core";
import { useElementSize, useMergedRef } from "@mantine/hooks";
import { parseToRgb, rgbToColorString, transparentize } from "polished";
import { easeOut } from "motion/react";

import { UseAudioLevelsData, useAudioLevels } from "@ui/hooks/useAudioLevels";
import { theme } from "@ui/theme";
import { colorInterpolate, isSameRgb } from "@ui/utils";

export type VUMeterProps = {
  orientation: 'vertical' | 'horizontal';
  channel: 'left' | 'right';
  peakWidth?: number;
}

export const VUMeter: React.FC<VUMeterProps> = ({ orientation, channel, peakWidth = 2 * 5 }) => {
  const elementSize = useElementSize();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const elementRef = useMergedRef(elementSize.ref, canvasRef);
  const ctxRef = useRef<CanvasRenderingContext2D | undefined>(undefined);
  const gradientRef = useRef<CanvasGradient | undefined>(undefined);
  const audRef = useRef<UseAudioLevelsData>(undefined);
  const raf = useRef(0);

  useEffect(() => {
    ctxRef.current = canvasRef.current?.getContext('2d') ?? undefined;
  }, [canvasRef.current]);

  useEffect(() => {
    if (ctxRef.current) {
      const grad = orientation === 'horizontal'
        ? ctxRef.current.createLinearGradient(0, 0, elementSize.width * 10, elementSize.height)
        : ctxRef.current.createLinearGradient(elementSize.width, elementSize.height * 10, 0, 0)

      grad.addColorStop(0.1, transparentize('0.97', theme.colors.green[5]));
      grad.addColorStop(0.4, transparentize('0.5', theme.colors.green[5]));
      grad.addColorStop(0.8, theme.colors.green[5]);
      grad.addColorStop(0.94, theme.colors.yellow[5]);
      grad.addColorStop(0.97, theme.colors.red[5]);
      gradientRef.current = grad;

      update();
    }

  }, [orientation, ctxRef.current, elementSize.width, elementSize.height]);

  let lastPeakColor = parseToRgb('#ffffff');
  let peakColorFrom = lastPeakColor;
  let intpPeakColor = peakColorFrom;
  let peakColorTo = peakColorFrom;
  let lastPeakColorTime = 0;

  const fillRect = useCallback((ctx: CanvasRenderingContext2D, from: number, size: number) => {
    switch (orientation) {
      case 'horizontal':
        ctx.fillRect(
          from, 0,
          size, ctx.canvas.height
        );
        return;

      case 'vertical':
        ctx.fillRect(
          0, ctx.canvas.height - from - size,
          ctx.canvas.width, size
        );
        return;
    }
  }, [orientation]);

  const draw = useCallback(() => {
    const data = audRef.current;
    const ctx = ctxRef.current;
    const grad = gradientRef.current;

    if (!ctx || !grad) {
      return;
    }

    const w = orientation === 'horizontal' ? ctx.canvas.width : ctx.canvas.height;

    ctx.fillStyle = theme.colors.dark[8];
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    ctx.fillStyle = grad;
    ctx.globalAlpha = 0.12;

    fillRect(ctx,
      0,
      w
    );

    const {
      scaled: { magnitude = 0, peak = 0 },
      db: { peak: peakDb = -100 },
    } = data?.[channel] ?? { scaled: {}, db: {} };

    ctx.globalAlpha = 1;
    fillRect(ctx,
      0,
      magnitude * w
    );

    if (data?.reduction) {
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = theme.colors.grape[4];
      fillRect(ctx,
        data.reduction * w,
        w
      );
    }

    const peakColor = parseToRgb((peakDb >= -3)
      ? theme.colors.red[4]
      : (peakDb >= -6)
        ? theme.colors.yellow[4]
        : '#ffffff');

    const now = performance.now();

    if (!isSameRgb(peakColor, lastPeakColor)) {
      peakColorFrom = intpPeakColor;
      peakColorTo = peakColor;

      lastPeakColor = peakColor;
      lastPeakColorTime = now;
    }

    const holdDuration = 500;
    const delta = now - lastPeakColorTime;

    intpPeakColor = (delta < holdDuration)
      ? colorInterpolate(peakColorFrom, peakColorTo, easeOut(delta / holdDuration))
      : peakColorTo;

    ctx.globalAlpha = 1;
    ctx.fillStyle = rgbToColorString(intpPeakColor);
    const peakPos = Math.max(peak * w - peakWidth, 0);
    fillRect(ctx,
      peakPos,
      peakWidth
    );

    raf.current = 0;
  }, [fillRect]);

  const update = useCallback(() => {
    cancelAnimationFrame(raf.current);

    raf.current = requestAnimationFrame(() => {
      draw();
      update();
    });
  }, [draw]);

  const audioLevelsHandler = useCallback((data: UseAudioLevelsData) => {
    if (document.hidden) {
      return;
    }

    audRef.current = data;
    update();
  }, [update]);

  useAudioLevels(audioLevelsHandler, [update]);

  return (
    <canvas
      ref={elementRef}
      width={elementSize.width * 10}
      height={elementSize.height * 10}
      style={{
        position: 'absolute',
        width: '100%',
        height: '100%'
      }}
    >

    </canvas>
  );
}

export type VUBarProps = {
  size?: number;
  gap?: MantineSpacing;
  orientation: VUMeterProps['orientation']
}

export const VUBar: React.FC<VUBarProps> = ({ orientation, size = 6, gap }) => {
  const mainProp = orientation === 'horizontal' ? 'h' : 'w';
  const crossProp = orientation === 'horizontal' ? 'w' : 'h';

  const containerProp = {
    direction: (orientation === 'horizontal' ? 'column' : 'row') as FlexProps['direction'],
    [mainProp]: size * 2,
    [crossProp]: '100%',
    gap
  }

  const barProp = {
    pos: 'relative' as MantineStyleProps['pos'],
    [mainProp]: size,
    [crossProp]: '100%'
  }

  return (
    <Flex {...containerProp}>
      <Box {...barProp}>
        <VUMeter channel="left" orientation={orientation} />
      </Box>
      <Box {...barProp}>
        <VUMeter channel="right" orientation={orientation} />
      </Box>
    </Flex>
  )
}
