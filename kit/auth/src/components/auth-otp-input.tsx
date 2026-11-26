import { useRef, useCallback, type KeyboardEvent, type ClipboardEvent } from 'react';

export function OtpInput(props: {
  value: string;
  onChange: (value: string) => void;
  length?: number;
  disabled?: boolean;
  dataTestId?: string;
}) {
  const { value, onChange, length = 6, disabled = false, dataTestId } = props;
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const digits = value.padEnd(length, '').split('').slice(0, length);

  const focusInput = useCallback((index: number) => {
    const el = inputRefs.current[index];
    if (el) {
      el.focus();
      el.select();
    }
  }, []);

  const handleChange = useCallback((index: number, raw: string) => {
    const cleaned = raw.replace(/\D/g, '');
    if (!cleaned) return;
    if (cleaned.length > 1) {
      const merged = [...digits];
      for (let offset = 0; offset < cleaned.length && index + offset < length; offset += 1) {
        merged[index + offset] = cleaned[offset]!;
      }
      const nextValue = merged.join('').replace(/[^\d]/g, '').slice(0, length);
      onChange(nextValue);
      focusInput(Math.min(index + cleaned.length, length - 1));
      return;
    }
    const newDigits = [...digits];
    newDigits[index] = cleaned;
    const newValue = newDigits.join('').replace(/[^\d]/g, '');
    onChange(newValue);
    if (index < length - 1) {
      focusInput(index + 1);
    }
  }, [digits, onChange, length, focusInput]);

  const handleKeyDown = useCallback((index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace') {
      event.preventDefault();
      const newDigits = [...digits];
      if (newDigits[index]) {
        newDigits[index] = '';
        onChange(newDigits.join('').replace(/[^\d]/g, ''));
      } else if (index > 0) {
        newDigits[index - 1] = '';
        onChange(newDigits.join('').replace(/[^\d]/g, ''));
        focusInput(index - 1);
      }
    } else if (event.key === 'ArrowLeft' && index > 0) {
      focusInput(index - 1);
    } else if (event.key === 'ArrowRight' && index < length - 1) {
      focusInput(index + 1);
    }
  }, [digits, onChange, length, focusInput]);

  const handlePaste = useCallback((event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    const pastedText = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
    if (pastedText) {
      onChange(pastedText);
      focusInput(Math.min(pastedText.length, length - 1));
    }
  }, [onChange, length, focusInput]);

  return (
    <div className="flex items-center justify-center gap-2" data-testid={dataTestId}>
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(el) => { inputRefs.current[index] = el; }}
          type="text"
          inputMode="numeric"
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          aria-label={`Verification code digit ${index + 1} of ${length}`}
          maxLength={index === 0 ? length : 1}
          value={digit || ''}
          disabled={disabled}
          className="h-12 w-10 rounded-lg border border-[var(--nimi-field-border)] bg-[var(--nimi-field-bg)] text-center tabular-nums text-xl font-bold text-[var(--nimi-text-primary)] outline-none transition-[border-color,box-shadow] duration-[var(--nimi-motion-fast)] focus-visible:border-[var(--nimi-field-focus)] focus-visible:ring-[length:var(--nimi-focus-ring-width)] focus-visible:ring-[var(--nimi-focus-ring-color)] disabled:opacity-50"
          onChange={(e) => handleChange(index, e.target.value)}
          onKeyDown={(e) => handleKeyDown(index, e)}
          onPaste={handlePaste}
          onFocus={(e) => e.target.select()}
          autoFocus={index === 0}
        />
      ))}
    </div>
  );
}
