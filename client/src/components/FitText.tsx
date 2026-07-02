import { useEffect, useRef, type ReactNode } from 'react';
import styles from './FitText.module.css';

interface FitTextProps {
  children: ReactNode;
  className?: string;
  'data-testid'?: string;
  maxFontSize?: number;
  minFontSize?: number;
}

export function FitText({
  children,
  className,
  'data-testid': testId,
  maxFontSize = 96,
  minFontSize = 12,
}: FitTextProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;

    const fit = () => {
      const containerWidth = container.clientWidth;
      const containerHeight = container.clientHeight;
      if (containerWidth === 0 || containerHeight === 0) return;

      let low = minFontSize;
      let high = maxFontSize;
      let best = minFontSize;

      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        content.style.fontSize = `${mid}px`;
        if (content.scrollWidth <= containerWidth && content.scrollHeight <= containerHeight) {
          best = mid;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }

      content.style.fontSize = `${best}px`;
    };

    fit();

    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
    resizeObserver?.observe(container);

    return () => {
      resizeObserver?.disconnect();
    };
  }, [children, maxFontSize, minFontSize]);

  return (
    <div ref={containerRef} className={styles.fitContainer}>
      <div
        ref={contentRef}
        className={className}
        data-testid={testId}
        data-fit-text="true"
        style={{ fontSize: `${maxFontSize}px` }}
      >
        {children}
      </div>
    </div>
  );
}
