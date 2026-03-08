import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
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

  const hiddenTransform = placement === 'bottom' ? '-translate-y-1' : 'translate-y-1';
  const visibleTransform = placement === 'bottom' ? 'translate-y-0' : '-translate-y-0';
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
            <div
              ref={tooltipRef}
              className={`fixed z-[9999] -translate-x-1/2 transition-all duration-200 ${
                isVisible
                  ? `opacity-100 ${visibleTransform}`
                  : `pointer-events-none opacity-0 ${hiddenTransform}`
              }`}
              style={{
                left: coords ? `${coords.left}px` : '-9999px',
                top: coords ? `${coords.top}px` : '-9999px',
              }}
            >
              <div
                className={`max-w-[min(22rem,calc(100vw-2rem))] rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white shadow-[0_4px_20px_rgba(0,0,0,0.25)] ${
                  multiline ? 'whitespace-normal break-words' : 'whitespace-nowrap'
                } ${contentClassName}`.trim()}
              >
                {content}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
