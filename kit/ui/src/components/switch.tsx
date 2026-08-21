import { cn } from '../design-tokens.js';
import { FOCUS_RING_CLASS_NAME } from '../a11y/focus.js';

type ToggleProps = {
  checked: boolean;
  /** Called with the next checked state. Preferred over `onChange`. */
  onValueChange?: (checked: boolean) => void;
  /** @deprecated Use `onValueChange` instead. When both are passed, `onValueChange` wins. */
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
};

export function Toggle({ checked, onValueChange, onChange, disabled = false, className, ariaLabel }: ToggleProps) {
  const state = checked ? 'checked' : 'unchecked';
  const handleToggle = () => {
    if (onValueChange) {
      onValueChange(!checked);
    } else {
      onChange?.(!checked);
    }
  };
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      data-state={state}
      data-disabled={disabled ? '' : undefined}
      disabled={disabled}
      onClick={handleToggle}
      className={cn(
        'nimi-toggle inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-[background-color,transform] duration-[var(--nimi-motion-fast)] ease-[var(--nimi-motion-ease-standard)] active:scale-[var(--nimi-motion-pressed-scale)] disabled:cursor-not-allowed disabled:opacity-[var(--nimi-opacity-disabled)]',
        'data-[state=checked]:nimi-toggle--on data-[state=unchecked]:nimi-toggle--off data-[state=checked]:bg-[var(--nimi-action-primary-bg)] data-[state=unchecked]:bg-[var(--nimi-toggle-off-bg)]',
        FOCUS_RING_CLASS_NAME,
        className,
      )}
    >
      <span
        data-state={state}
        data-disabled={disabled ? '' : undefined}
        className="nimi-toggle__thumb pointer-events-none block h-5 w-5 rounded-full bg-[var(--nimi-surface-card)] shadow-sm ring-0 transition-transform duration-[var(--nimi-motion-fast)] ease-[var(--nimi-motion-ease-standard)] data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0"
      />
    </button>
  );
}
