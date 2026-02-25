import type React from 'react';
import {
  statusClassV11,
  statusTextV11,
  type ProviderStatusV11,
} from '@renderer/features/runtime-config/state/v11/types';

export function Card({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={`rounded-[10px] border border-gray-200 bg-white ${className}`}>{children}</div>;
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  disabled,
  size = 'md',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
  size?: 'sm' | 'md';
}) {
  const variantClass = variant === 'primary'
    ? 'bg-brand-600 text-white hover:bg-brand-700 disabled:bg-gray-300'
    : variant === 'secondary'
      ? 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:bg-gray-100'
      : 'text-gray-600 hover:bg-gray-50 disabled:text-gray-300';

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
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-gray-700">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-[46px] w-full rounded-[10px] border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 outline-none transition-colors focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
      />
    </div>
  );
}

export function StatusBadge({ status }: { status: ProviderStatusV11 }) {
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${statusClassV11(status)}`}>
      {statusTextV11(status)}
    </span>
  );
}

export function renderModelChips(models: string[], prefix: string) {
  if (models.length === 0) {
    return <p className="mt-1 text-xs text-gray-500">No models discovered yet.</p>;
  }

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {models.map((model) => (
        <span key={`${prefix}-${model}`} className="rounded-md border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] text-gray-700">
          {model}
        </span>
      ))}
    </div>
  );
}
