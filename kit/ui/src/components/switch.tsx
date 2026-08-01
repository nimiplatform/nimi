import { cn } from '../design-tokens.js';

type ToggleProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
};

export function Toggle({ checked, onChange, disabled = false, className, ariaLabel }: ToggleProps) {
  const state = checked ? 'checked' : 'unchecked';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      data-state={state}
      data-disabled={disabled ? '' : undefined}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'nimi-toggle inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-[background-color,transform] duration-[var(--nimi-motion-fast)] ease-[var(--nimi-motion-ease-standard)] active:scale-[var(--nimi-motion-pressed-scale)] disabled:cursor-not-allowed disabled:opacity-[var(--nimi-opacity-disabled)]',
        'data-[state=checked]:nimi-toggle--on data-[state=unchecked]:nimi-toggle--off data-[state=checked]:bg-[var(--nimi-action-primary-bg)] data-[state=unchecked]:bg-[var(--nimi-toggle-off-bg)]',
        className,
      )}
    >
      <span
        data-state={state}
        data-disabled={disabled ? '' : undefined}
        className="nimi-toggle__thumb pointer-events-none block h-5 w-5 rounded-full bg-white shadow-sm ring-0 transition-transform duration-[var(--nimi-motion-fast)] ease-[var(--nimi-motion-ease-standard)] data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0"
      />
    </button>
  );
}
