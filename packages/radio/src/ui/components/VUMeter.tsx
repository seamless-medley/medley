import styled from "@emotion/styled";
import React from "react";
import { useRef } from "react";
import { useAudioLevels } from "../hooks/useAudioLevels";

const Box = styled.div`
  width: 500px;
  height: 100%;
  position: relative;
  border-radius: 0.25em 0px 0px 0px;
  background-color: rgba(200, 200, 255, 0.3);
  transition: all 0.2s ease;
  white-space: nowrap;
  transition: width 2s ease, height 2s ease;
`;

const Level = styled.div`
  position: absolute;
  left: 0;
  top: 0;
  right: 100%;
  bottom: 0;
  background-color: rgba(77, 224, 66, 0.877);
`;

const Peak = styled.div`
  position: absolute;
  width: 2px;
  top: 0;
  bottom: 0;
  left: 0%;

  background-color: rgba(226, 28, 104, 0.902);
`;

const Reduction = styled.div`
  position: absolute;
  left: 100%;
  right: 0;
  top: 0;
  bottom: 0;

  background-color: rgba(97, 22, 236, 0.902);
`;

export type VUMeterProps = {
  channel: 'left' | 'right';
}

export const VUMeter: React.FC<VUMeterProps> = ({ channel }) => {
  const levelRef = useRef<HTMLDivElement>(null);
  const reductionRef = useRef<HTMLDivElement>(null);
  const peakRef = useRef<HTMLDivElement>(null);

  useAudioLevels((data) => {
    const { current: levelEl } = levelRef;
    const { current: reductionEl } = reductionRef;
    const { current: peakEl } = peakRef;

    if (!levelEl || !peakEl || !reductionEl) {
      return;
    }

    const { level, peak } = data[channel];

    levelEl.style.right = `${(1-level) * 100}%`;
    peakEl.style.left = `${(peak) * 100}%`;

    reductionEl.style.left = `${(data.reduction) * 100}%`
  });

  return (
    <div style={{ height: '24px' }}>
      <Box>
        <Level ref={levelRef} />
        <Reduction ref={reductionRef} />
        <Peak ref={peakRef}/>
      </Box>
    </div>
  );
}
