import React, { useEffect } from "react";
import { useRef } from "react";
import { useAudioLevels } from "../hooks/useAudioLevels";
import { styled } from "@linaria/react";
import { theme } from "../theme/theme";

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
  channel: 'left' | 'right';
  peakWidth?: number;
}

// TODO: Keep this as a experimental reference, and create a new one based on canvas
export const VUMeter: React.FC<VUMeterProps> = ({ channel, peakWidth = 2 }) => {
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
