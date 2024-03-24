import React, { useCallback, useEffect } from "react";
import { useRef } from "react";
import { UseAudioLevelsData, useAudioLevels } from "../hooks/useAudioLevels";
import { styled } from "@linaria/react";
import { theme } from "../theme/theme";
import { useElementSize, useMergedRef } from "@mantine/hooks";
import { parseToRgb, rgbToColorString, transparentize } from "polished";
import { RgbColor } from "polished/lib/types/color";
import { easeOut } from "framer-motion";
import { Box, Flex, FlexProps, MantineStyleProps } from "@mantine/core";

const Container = styled.div`
  width: 100%;
  height: 100%;
  position: relative;
  transition: all 0.2s ease;
  white-space: nowrap;
  transition: width 2s ease, height 2s ease;
`;

const LevelBG = styled.div`
  position: absolute;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  background-image: linear-gradient(to right,
    ${theme.colors.green[5]} 80%,
    ${theme.colors.yellow[5]} 94%,
    ${theme.colors.red[5]} 97%
  );
`

const Level = styled.div`
  position: absolute;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  will-change: left;
  background-color: rgb(0 0 0 / 0.9);
`;

const Peak = styled.div`
  position: absolute;
  width: 2px;
  top: 0;
  bottom: 0;
  right: calc(100% - 2px);
  isolation: isolate;
  will-change: right, background-color;
  transition: background-color ease 0.5s;
  background-color: white;
  opacity: 0.9;
`;

const Reduction = styled.div`
  position: absolute;
  left: 100%;
  right: 0;
  top: 0;
  bottom: 0;
  will-change: left;
  background-color: ${theme.colors.grape[8]};
  opacity: 0.8;
`;

export type VUMeterProps = {
  orientation: 'vertical' | 'horizontal';
  channel: 'left' | 'right';
  peakWidth?: number;
}

export const LegacyVUMeter: React.FC<VUMeterProps> = ({ channel, peakWidth = 2 }) => {
  const levelRef = useRef<HTMLDivElement>(null);
  const reductionRef = useRef<HTMLDivElement>(null);
  const peakRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (peakRef.current) {
      peakRef.current.style.width = `${peakWidth}px`;
    }
  }, [peakWidth, peakRef]);

  useAudioLevels((data) => {
    const { current: levelEl } = levelRef;
    const { current: reductionEl } = reductionRef;
    const { current: peakEl } = peakRef;

    if (!levelEl || !peakEl || !reductionEl) {
      return;
    }

    const {
      scaled: { magnitude, peak },
      db: { peak: peakDb }
    } = data[channel];

    levelEl.style.left = `${(magnitude) * 100}%`;
    peakEl.style.right = `calc(${(1-peak) * 100}% - ${peak == 0 ? peakWidth : 0}px)`;
    peakEl.style.backgroundColor = (peakDb >= -3)
      ? theme.colors.red[8]
      : (peakDb >= -6)
        ? theme.colors.yellow[8]
        : 'white';

    reductionEl.style.left = `${(data.reduction) * 100}%`
  });

  return (
    <Container>
      <LevelBG />
      <Level ref={levelRef} />
      <Reduction ref={reductionRef} />
      <Peak ref={peakRef}/>
    </Container>
  );
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

const isSameRgb = (a: RgbColor, b: RgbColor) => !(
  (a.red !== b.red) ||
  (a.green !== b.green) ||
  (a.blue !== b.blue)
)

function colorInterpolate(a: RgbColor, b: RgbColor, p: number): RgbColor {
  const lerp = (v1: number, v2: number) => Math.round(v1 * (1 - p) + v2 * p);

  return {
    red: lerp(a.red, b.red),
    green: lerp(a.green, b.green),
    blue: lerp(a.blue, b.blue),
  }
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
