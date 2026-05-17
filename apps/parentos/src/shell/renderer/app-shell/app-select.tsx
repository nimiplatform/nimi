import type { CSSProperties } from 'react';
import { SelectField, type SelectFieldOption } from '@nimiplatform/nimi-kit/ui';

export type AppSelectOption = SelectFieldOption;

export interface AppSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: AppSelectOption[];
  /** Text shown when value is ''. */
  placeholder?: string;
  'aria-label'?: string;
  className?: string;
  /** Class merged into the portaled dropdown panel — use to bump z-index above custom modal stacks. */
  contentClassName?: string;
  style?: CSSProperties;
}

export function AppSelect({ value, onChange, options, placeholder, className, contentClassName, style, 'aria-label': ariaLabel }: AppSelectProps) {
  const select = (
    <SelectField
      value={value}
      onValueChange={onChange}
      options={options}
      placeholder={placeholder}
      aria-label={ariaLabel}
      className={className}
      contentClassName={contentClassName}
    />
  );

  if (!style) {
    return select;
  }

  return (
    <div style={style}>
      {select}
    </div>
  );
}
