import { useRef, useState, type ReactNode } from 'react';
import { Surface } from '@nimiplatform/nimi-kit/ui';
import { SHELL_CHROME_TOOLTIP_CLASS } from './shell-chrome-classes';

export function SidebarTooltipButton({
  label,
  onClick,
  children,
  className = '',
  dataTestId,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  className?: string;
  dataTestId?: string;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number } | null>(null);

  const handleMouseEnter = () => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setTooltipPos({
        top: rect.top + rect.height / 2,
        left: rect.right + 8,
      });
    }
  };

  const handleMouseLeave = () => {
    setTooltipPos(null);
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        data-testid={dataTestId}
        onClick={onClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className={className}
        aria-label={label}
      >
        {children}
      </button>
      {tooltipPos ? (
        <Surface
          as="span"
          tone="overlay"
          material="glass-thick"
          padding="none"
          className={SHELL_CHROME_TOOLTIP_CLASS}
          style={{
            top: tooltipPos.top,
            left: tooltipPos.left,
            transform: 'translateY(-50%)',
          }}
        >
          {label}
        </Surface>
      ) : null}
    </>
  );
}
