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

  const handleChange = useCallback((index: number, char: string) => {
    if (!/^\d$/.test(char)) return;
    const newDigits = [...digits];
    newDigits[index] = char;
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
          maxLength={1}
          value={digit || ''}
          disabled={disabled}
          className="h-12 w-10 rounded-lg border border-[var(--auth-input-border,#ddd4c6)] bg-[var(--auth-input-bg,rgba(255,255,255,0.9))] text-center text-xl font-bold text-[var(--auth-text-secondary,#1f1b16)] outline-none transition focus:border-[var(--auth-primary,#4ECCA3)] focus:ring-2 focus:ring-[var(--auth-primary,#4ECCA3)]/50 disabled:opacity-50"
          onChange={(e) => handleChange(index, e.target.value.slice(-1))}
          onKeyDown={(e) => handleKeyDown(index, e)}
          onPaste={handlePaste}
          onFocus={(e) => e.target.select()}
          autoFocus={index === 0}
        />
      ))}
    </div>
  );
}
