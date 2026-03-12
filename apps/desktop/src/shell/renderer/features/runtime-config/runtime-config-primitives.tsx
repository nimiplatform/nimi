import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { i18n } from '@renderer/i18n';
import { Tooltip } from '@renderer/components/tooltip.js';
import {
  statusTextV11,
  type ProviderStatusV11,
} from '@renderer/features/runtime-config/runtime-config-state-types';

export function Card({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`rounded-2xl bg-white shadow-[0_6px_18px_rgba(15,23,42,0.04)] ring-1 ring-black/[0.04] ${className}`}>{children}</div>;
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  disabled,
  size = 'md',
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
  size?: 'sm' | 'md';
}) {
  const variantClass = variant === 'primary'
    ? 'bg-mint-500 text-white hover:bg-mint-600 disabled:bg-gray-300'
    : variant === 'secondary'
      ? 'border border-mint-200 bg-white text-mint-700 hover:bg-mint-50 disabled:bg-gray-100 disabled:text-gray-400'
      : 'text-mint-700 hover:bg-mint-50 disabled:text-gray-300';

  const sizeClass = size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-[10px] font-medium transition-colors disabled:cursor-not-allowed ${variantClass} ${sizeClass}`}
    >
      {children}
    </button>
  );
}

export function Input({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  disabled?: boolean;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-gray-700">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="h-[46px] w-full rounded-[10px] border border-mint-100 bg-[#F4FBF8] px-3 text-sm text-gray-900 outline-none transition-colors placeholder:text-gray-400 focus:border-mint-400 focus:bg-white focus:ring-2 focus:ring-mint-100 disabled:opacity-60"
      />
    </div>
  );
}

export type RuntimeSelectOption = {
  value: string;
  label: string;
};

export function RuntimeSelect({
  value,
  onChange,
  options,
  disabled,
  size = 'md',
  className = '',
}: {
  value: string;
  onChange: (value: string) => void;
  options: RuntimeSelectOption[];
  disabled?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedLabel = options.find((item) => item.value === value)?.label || value;

  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, []);

  const triggerClass = size === 'sm'
    ? 'h-8 rounded-md px-2 text-xs'
    : 'h-10 rounded-xl px-3 text-sm';
  const menuClass = size === 'sm' ? 'rounded-md' : 'rounded-xl';
  const itemClass = size === 'sm' ? 'px-2 py-1.5 text-xs' : 'px-3 py-2 text-sm';

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => !disabled && setOpen((prev) => !prev)}
        disabled={disabled}
        className={`flex w-full items-center justify-between border border-mint-100 bg-[#F4FBF8] text-gray-900 outline-none transition-all hover:border-mint-300 focus:border-mint-400 focus:bg-white focus:ring-2 focus:ring-mint-100 disabled:opacity-60 ${triggerClass}`}
      >
        <Tooltip content={selectedLabel} placement="top" className="min-w-0 flex-1 justify-start">
          <span className="min-w-0 flex-1 truncate text-left">{selectedLabel}</span>
        </Tooltip>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open ? (
        <div className={`absolute z-50 mt-1 min-w-full max-w-[min(28rem,calc(100vw-2rem))] overflow-auto border border-mint-100 bg-white py-1 shadow-lg ${menuClass}`}>
          {options.map((option) => {
            const selected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 text-left transition-colors ${
                  selected ? 'bg-mint-50 font-medium text-mint-700' : 'text-gray-700 hover:bg-mint-50/60'
                } ${itemClass}`}
              >
                {selected ? (
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="shrink-0 text-mint-500"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <span className="w-4 shrink-0" />
                )}
                <span className="whitespace-normal break-words text-left">{option.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

// Status indicator with dot - using semi-transparent backgrounds
function StatusIndicator({
  status,
  text,
  variant: _variant,
}: {
  status: 'healthy' | 'idle' | 'unreachable' | 'unsupported' | 'degraded' | 'running' | 'stopped';
  text: string;
  variant?: 'daemon' | 'provider';
}) {
  const styles = {
    // Daemon states
    running: {
      bg: 'bg-green-500/10',
      text: 'text-green-700',
      dot: 'bg-green-500',
      ring: 'ring-green-500/20',
    },
    stopped: {
      bg: 'bg-red-500/10',
      text: 'text-red-700',
      dot: 'bg-red-500',
      ring: 'ring-red-500/20',
    },
    // Provider states
    healthy: {
      bg: 'bg-green-500/10',
      text: 'text-green-700',
      dot: 'bg-green-500',
      ring: 'ring-green-500/20',
    },
    idle: {
      bg: 'bg-gray-500/10',
      text: 'text-gray-600',
      dot: 'bg-gray-400',
      ring: 'ring-gray-400/20',
    },
    unreachable: {
      bg: 'bg-red-500/10',
      text: 'text-red-700',
      dot: 'bg-red-500',
      ring: 'ring-red-500/20',
    },
    unsupported: {
      bg: 'bg-orange-500/10',
      text: 'text-orange-700',
      dot: 'bg-orange-500',
      ring: 'ring-orange-500/20',
    },
    degraded: {
      bg: 'bg-yellow-500/10',
      text: 'text-yellow-700',
      dot: 'bg-yellow-500',
      ring: 'ring-yellow-500/20',
    },
  };

  const style = styles[status];

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${style.bg} ${style.text} ring-1 ${style.ring}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
      {text}
    </span>
  );
}

export function StatusBadge({ status }: { status: ProviderStatusV11 }) {
  const statusMap: Record<ProviderStatusV11, 'healthy' | 'idle' | 'unreachable' | 'unsupported' | 'degraded'> = {
    healthy: 'healthy',
    idle: 'idle',
    unreachable: 'unreachable',
    unsupported: 'unsupported',
    degraded: 'degraded',
  };

  return (
    <StatusIndicator 
      status={statusMap[status]} 
      text={statusTextV11(status)} 
      variant="provider"
    />
  );
}

export function DaemonStatusBadge({ running }: { running: boolean }) {
  return (
    <StatusIndicator 
      status={running ? 'running' : 'stopped'} 
      text={i18n.t(`runtimeConfig.overview.${running ? 'running' : 'stopped'}`, {
        defaultValue: running ? 'daemon running' : 'daemon stopped',
      })}
      variant="daemon"
    />
  );
}

export function renderModelChips(models: string[], prefix: string) {
  if (models.length === 0) {
    return (
      <p className="mt-1 text-xs text-gray-500">
        {i18n.t('runtimeConfig.common.noModelsDiscovered', { defaultValue: 'No models discovered yet.' })}
      </p>
    );
  }

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {models.map((model) => (
        <span key={`${prefix}-${model}`} className="rounded-md border border-mint-100 bg-mint-50/60 px-2 py-0.5 text-[11px] text-mint-800">
          {model}
        </span>
      ))}
    </div>
  );
}
