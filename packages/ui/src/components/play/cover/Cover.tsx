import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CoverDisc, CoverImage, CoverContainer, CoverDecorator } from './elements';

export type CoverProps = {
  url?: string;
  colors: string[];
  center: boolean;
  uuid: string;
}

export const Cover: React.FC<CoverProps> = ({ center, url, colors, uuid }) => {
  const containerEl = useRef<HTMLDivElement>(null);
  const imageEl = useRef<HTMLImageElement>(null);

  const [discColors, setDiscColors] = useState(colors);

  const updateCenter = () => {
    const c = 'center';

    if (center) {
      containerEl.current?.classList.add(c);
    } else {
      containerEl.current?.classList.remove(c);
    }
  }

  const hide = () => {
    containerEl.current?.classList.remove('visible');
  }

  const reveal = useCallback(() => {
    setDiscColors(colors);

    if (imageEl.current) {
      imageEl.current.classList.remove('visible');
      imageEl.current.src = url || '';

      imageEl.current.classList.add('visible');
    }

    containerEl.current?.classList.add('visible');
  }, [url]);

  const animationTimer = useRef<number>();

  const revealThenCenter = () => {
    hide();

    if (animationTimer.current) {
      clearTimeout(animationTimer.current);
    }

    animationTimer.current = setTimeout(() => {
      reveal();
      setTimeout(updateCenter, 1e3);
    }, 1.1e3) as unknown as number;
  }

  const centerThenReveal = () => {
    updateCenter();

    if (animationTimer.current) {
      clearTimeout(animationTimer.current);
    }

    animationTimer.current = setTimeout(() => {
      hide();
      setTimeout(reveal, 1.1e3);
    }, 1e3) as unknown as number;
  }

  useEffect(() => {
    const isCentered = containerEl.current?.classList.contains('center') ?? false;
    const animate =  (isCentered && !center) ? centerThenReveal : revealThenCenter;
    animate();
  }, [center, url, colors, uuid]);

  return (
    <>
      <CoverContainer ref={containerEl} className='visible'>
        <CoverDisc colors={discColors}>
          <CoverImage ref={imageEl} style={{ opacity: url ? 0.77 : 0 }} />
          <CoverDecorator />
        </CoverDisc>
      </CoverContainer>
    </>
  )
}
