import { useEffect, useState, type ReactNode } from 'react';

export function LoadingSpinner({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center justify-center gap-1 ${className}`}>
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--auth-primary,#4ECCA3)]" style={{ animationDelay: '0ms' }} />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--auth-primary,#4ECCA3)]" style={{ animationDelay: '150ms' }} />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--auth-primary,#4ECCA3)]" style={{ animationDelay: '300ms' }} />
    </div>
  );
}

export function AnimateIn({ children, className = '', delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), Math.max(delay, 16));
    return () => clearTimeout(timer);
  }, [delay]);

  return (
    <div
      className={`transition-all duration-300 ease-out ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'
      } ${className}`}
    >
      {children}
    </div>
  );
}
