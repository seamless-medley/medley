import styled from "@emotion/styled";
import { setLightness, transparentize } from 'polished';

export const Container = styled.div`
  position: absolute;
  bottom: 0;
  right: 0;
  z-index: 30;

  transition: bottom 4s ease;
  transition-delay: 0.8s;

  will-change: bottom;

  &.withNext {
    bottom: 1.2em;
    transition: bottom 1.2s ease;
    transition-delay: 0s;
  }
`;

export const Box = styled.div`
  position: relative;
  padding: 0.12em 0.6em;
  border-radius: 0.25em 0px 0px 0px;
  background-color: rgba(200, 200, 255, 0.3);
  transition: all 0.2s ease;
  white-space: nowrap;
  height: 1.0em;
  width: 10vw;

  transition: width 2s ease, height 2s ease;
`;


export const ProgressText = styled.div<{ backgroundColor: string, textColor: string }>`
  position: absolute;
  display: flex;
  background-size: 300vw;

  justify-content: left;
  align-items: center;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;

  padding-left: calc(50% - (0.6em * 5 / 2));
  padding-top: 0.15em;

  border-radius: 0.25em 0px 0px 0px;

  user-select: none;

  & > span {
    display: inline-block;
    width: 0.6em;
    text-align: center;
    color: inherit;
  }

  will-change: background-position, background-image, color;

  background-size: 2.5vh 2.5vh;
  animation: move 2s linear infinite;

  @keyframes move {
    0% {
      background-position: 0 0;
    }
    100% {
      background-position: 2.5vh 2.5vh;
    }
  }

  transform: translateZ(0) rotateZ(360deg);
  transition:
    clip-path 0.2s ease,
    background-color 2.2s ease-in-out,
    color 2.2s ease-in-out;

  background-image: linear-gradient(
    -45deg,
    ${props => transparentize(0.3, props.backgroundColor)} 25%,
    transparent 25%,
    transparent 50%,
     ${props => transparentize(0.3, props.backgroundColor)} 50%,
     ${props => transparentize(0.3, props.backgroundColor)} 75%,
    transparent 75%,
    transparent
  );

  color: ${props => setLightness(0.65, props.textColor)};
`;

export const Mask = styled.div`
  position: absolute;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;

  background-color: rgb(0 0 0 / 0.5);

  transform: translateZ(0) rotateZ(360deg);

  transition: left 0.5s ease;
`

export const Next = styled.div<{ color: string }>`
  position: absolute;
  display: flex;

  bottom: 0;
  right: 0;
  z-index: 20;

  justify-content: center;
  align-items: center;
  font-size: 0.6em;

  user-select: none;

  padding: 0.4em;
  background-color: rgba(200, 200, 255, 0.3);
  white-space: nowrap;
  height: 2.0em;

  color: ${props => props.color};

  opacity: 0;

  transition: opacity 4s ease, color 4s ease, width 2s ease;

  &.show {
    opacity: 1;
    transition: opacity 0.6s ease, color 4s ease, width 2s ease;
  }

  &.loading > * {
    animation: blink 0.5s linear alternate infinite;
  }

  @keyframes blink {
    from {
      opacity: 1;
    }

    to {
      opacity: 0.15;
    }
  }
`;
