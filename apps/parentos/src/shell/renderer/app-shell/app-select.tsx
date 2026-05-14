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
  style?: CSSProperties;
}

export function AppSelect({ value, onChange, options, placeholder, className, style, 'aria-label': ariaLabel }: AppSelectProps) {
  const select = (
    <SelectField
      value={value}
      onValueChange={onChange}
      options={options}
      placeholder={placeholder}
      aria-label={ariaLabel}
      className={className}
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
