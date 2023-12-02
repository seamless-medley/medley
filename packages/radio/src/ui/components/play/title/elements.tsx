import styled from "@emotion/styled";

export const TitleContainer = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  transform: translate(0, 0);

  z-index: 30;

  transition:
      transform 0.6s ease 0s,
      left 0.6s ease 0s,
      top 0.6s ease 0.6s
      ;

  &.center {
    top: calc(50% - 1.6em);
    left: 50%;
    transform: translate(-50%, 0);

    transition:
      top 0.6s ease 0s,
      transform 0.6s ease 0.6s,
      left 0.6s ease 0.6s
    ;
  }
`;

export const TitleBox = styled.div`
  padding: 0.12em 0.6em 0.12em 0.33em;
  border-radius: 0px 0px 0.25em 0px;
  background-color: rgba(200, 200, 255, 0.3);
  transition: all 0.2s ease, border-radius 0.6s ease;
  white-space: nowrap;
  min-height: 1.6em;

  &.center {
    border-radius: 0.25em;
  }
`;

export const TitleText = styled.div`
  background-size: 300vw;

  animation: bg 15s infinite alternate linear;

  background-clip: text;
  -webkit-background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
  line-height: 1.6em;
  user-select: none;

  transform: translateX(0px) translateZ(0) rotateZ(360deg);

  transition: transform 1s ease;

  @keyframes bg {
    0% { background-position: 0% 0%; }
    100% { background-position: 100% 100%; }
  }
`;
