import { useRef } from 'react';

// OTP Input Component - 6 digit separate boxes
export function OtpInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const handleChange = (index: number, digit: string) => {
    if (!/^\d*$/.test(digit)) return;

    const newValue = value.slice(0, index) + digit + value.slice(index + 1);
    onChange(newValue.slice(0, 6));

    // Auto-focus next input
    if (digit && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      if (!value[index] && index > 0) {
        // If current box is empty, move focus to previous and clear it
        onChange(value.slice(0, index - 1) + value.slice(index));
        inputRefs.current[index - 1]?.focus();
      } else {
        // Clear current box
        onChange(value.slice(0, index) + value.slice(index + 1));
      }
    } else if (e.key === 'ArrowLeft' && index > 0) {
      inputRefs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    onChange(pastedData);

    // Focus the appropriate input
    if (pastedData.length < 6) {
      inputRefs.current[pastedData.length]?.focus();
    } else {
      inputRefs.current[5]?.focus();
    }
  };

  return (
    <div className="flex justify-center gap-2">
      {Array.from({ length: 6 }, (_, index) => (
        <input
          key={index}
          ref={(el) => { inputRefs.current[index] = el; }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={value[index] || ''}
          onChange={(e) => handleChange(index, e.target.value)}
          onKeyDown={(e) => handleKeyDown(index, e)}
          onPaste={handlePaste}
          className="w-10 h-12 text-center text-xl font-bold rounded-lg border transition-all duration-200 outline-none focus:border-[#4ECCA3] focus:ring-2 focus:ring-[#4ECCA3]/30"
          style={{
            borderColor: value[index] ? '#4ECCA3' : '#E5E5E5',
            backgroundColor: '#FFFFFF',
            color: '#1A1A1A'
          }}
        />
      ))}
    </div>
  );
}
