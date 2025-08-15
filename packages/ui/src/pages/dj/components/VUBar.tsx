import React, { useCallback, useEffect, useRef } from "react";
import { Box, Flex, FlexProps, MantineStyleProps } from "@mantine/core";
import { useElementSize, useMergedRef } from "@mantine/hooks";
import { parseToRgb, rgbToColorString, transparentize } from "polished";
import { easeOut } from "framer-motion";

import { UseAudioLevelsData, useAudioLevels } from "@ui/hooks/useAudioLevels";
import { theme } from "@ui/theme/theme";
import { colorInterpolate, isSameRgb } from "@ui/utils";

export type VUMeterProps = {
  orientation: 'vertical' | 'horizontal';
  channel: 'left' | 'right';
  peakWidth?: number;
}

export const VUMeter: React.FC<VUMeterProps> = ({ orientation, channel, peakWidth = 2 }) => {
  const elementSize = useElementSize();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const elementRef = useMergedRef(elementSize.ref, canvasRef);
  const ctxRef = useRef<CanvasRenderingContext2D | undefined>(undefined);
  const gradientRef = useRef<CanvasGradient | undefined>(undefined);
  const audRef = useRef<UseAudioLevelsData>();
  const raf = useRef(0);

  useEffect(() => {
    ctxRef.current = canvasRef.current?.getContext('2d') ?? undefined;
  }, [canvasRef.current]);

  useEffect(() => {
    if (ctxRef.current) {
      const grad = orientation === 'horizontal'
        ? ctxRef.current.createLinearGradient(0, 0, elementSize.width, elementSize.height)
        : ctxRef.current.createLinearGradient(elementSize.width, elementSize.height, 0, 0)

      grad.addColorStop(0.1, transparentize('0.9', theme.colors.green[5]));
      grad.addColorStop(0.4, transparentize('0.5', theme.colors.green[5]));
      grad.addColorStop(0.8, theme.colors.green[5]);
      grad.addColorStop(0.94, theme.colors.yellow[5]);
      grad.addColorStop(0.97, theme.colors.red[5]);
      gradientRef.current = grad;

      update();
    }

  }, [ctxRef.current, elementSize.width, elementSize.height]);

  let lastPeakColor = parseToRgb('#ffffff');
  let peakColorFrom = lastPeakColor;
  let intpPeakColor = peakColorFrom;
  let peakColorTo = peakColorFrom;
  let lastPeakColorTime = 0;

  const fillRect = (ctx: CanvasRenderingContext2D, from: number, size: number) => {
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
  }

  const draw = useCallback(() => {
    const data = audRef.current;
    const ctx = ctxRef.current;
    const grad = gradientRef.current;

    if (!ctx || !grad) {
      return;
    }

    const w = orientation === 'horizontal' ? ctx.canvas.width : ctx.canvas.height;
    const h = orientation === 'horizontal' ? ctx.canvas.height : ctx.canvas.width;

    ctx.fillStyle = theme.colors.dark[8];
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)

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
      ctx.fillStyle = theme.colors.grape[8];
      fillRect(ctx,
        data.reduction * w,
        w
      );
    }

    const peakColor = parseToRgb((peakDb >= -3)
      ? theme.colors.red[8]
      : (peakDb >= -6)
        ? theme.colors.yellow[8]
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
  }, []);

  function update() {
    cancelAnimationFrame(raf.current);

    raf.current = requestAnimationFrame(() => {
      draw();
      update();
    });
  }

  useAudioLevels(data => {
    if (document.hidden) {
      return;
    }

    audRef.current = data;
    update();
  });

  return (
    <canvas
      ref={elementRef}
      width={elementSize.width}
      height={elementSize.height}
      style={{
        position: 'absolute',
        width: '100%',
        height: '100%'
      }}
    >

    </canvas>
  );
}

export const VUBar: React.FC<{ size?: number; orientation: VUMeterProps['orientation'] }> = ({ orientation, size = 6 }) => {
  const sizeProp = orientation === 'horizontal' ? 'h' : 'w';
  const sizeProp2 = orientation === 'horizontal' ? 'w' : 'h';

  const containerProp = {
    direction: (orientation === 'horizontal' ? 'column' : 'row') as FlexProps['direction'],
    [sizeProp]: size * 2
  }

  const barProp = {
    pos: 'relative' as MantineStyleProps['pos'],
    [sizeProp]: size,
    [sizeProp2]: '100%'
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
