import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { TooltipBubble } from '@nimiplatform/nimi-ui';
import { createPortal } from 'react-dom';

type TooltipProps = {
  children: ReactNode;
  content: string;
  placement?: 'top' | 'bottom';
  className?: string;
  contentClassName?: string;
  multiline?: boolean;
};

export function Tooltip({
  children,
  content,
  placement = 'bottom',
  className = '',
  contentClassName = '',
  multiline = false,
}: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [portalReady, setPortalReady] = useState(false);
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(null);
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  const gap = 8;

  useEffect(() => {
    setPortalReady(typeof document !== 'undefined');
  }, []);

  useLayoutEffect(() => {
    if (!isVisible || !triggerRef.current || !portalReady) {
      return;
    }

    const updatePosition = () => {
      if (!triggerRef.current || !tooltipRef.current) {
        return;
      }

      const triggerRect = triggerRef.current.getBoundingClientRect();
      const tooltipRect = tooltipRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let left = triggerRect.left + (triggerRect.width / 2);
      let top = placement === 'bottom'
        ? triggerRect.bottom + gap
        : triggerRect.top - gap - tooltipRect.height;

      const minLeft = (tooltipRect.width / 2) + 8;
      const maxLeft = viewportWidth - (tooltipRect.width / 2) - 8;
      left = Math.min(Math.max(left, minLeft), maxLeft);

      if (placement === 'top' && top < 8) {
        top = Math.min(triggerRect.bottom + gap, viewportHeight - tooltipRect.height - 8);
      } else if (placement === 'bottom' && top + tooltipRect.height > viewportHeight - 8) {
        top = Math.max(triggerRect.top - gap - tooltipRect.height, 8);
      }

      setCoords({ left, top });
    };

    updatePosition();
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);

    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [isVisible, placement, portalReady]);

  return (
    <div
      ref={triggerRef}
      className={`relative flex items-center justify-center ${className}`.trim()}
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
    >
      {children}
      {portalReady
        ? createPortal(
            <div ref={tooltipRef}>
              <TooltipBubble
                visible={isVisible}
                coords={coords}
                placement={placement}
                className="duration-200"
                contentClassName={`${multiline ? 'whitespace-normal break-words' : 'whitespace-nowrap'} ${contentClassName}`.trim()}
              >
                {content}
              </TooltipBubble>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
