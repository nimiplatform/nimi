import type { CSSProperties } from 'react';
import { SelectField, type SelectFieldOption } from '@nimiplatform/nimi-kit/ui';

export type AppSelectOption = SelectFieldOption;

export interface AppSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: AppSelectOption[];
  /** Text shown when value is ''. */
  placeholder?: string;
  className?: string;
  style?: CSSProperties;
}

export function AppSelect({ value, onChange, options, placeholder, className, style }: AppSelectProps) {
  const select = (
    <SelectField
      value={value}
      onValueChange={onChange}
      options={options}
      placeholder={placeholder}
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
