import type { ReactNode } from 'react';
import { motion, nimiReducedFade, nimiSpring, useNimiReducedMotion } from '@nimiplatform/kit/ui/motion';

export function LoadingSpinner({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center justify-center gap-1 ${className}`} role="status" aria-label="Loading">
      <span className="h-1.5 w-1.5 animate-bounce motion-reduce:animate-none rounded-full bg-[var(--nimi-action-primary-bg)]" style={{ animationDelay: '0ms' }} aria-hidden="true" />
      <span className="h-1.5 w-1.5 animate-bounce motion-reduce:animate-none rounded-full bg-[var(--nimi-action-primary-bg)]" style={{ animationDelay: '150ms' }} aria-hidden="true" />
      <span className="h-1.5 w-1.5 animate-bounce motion-reduce:animate-none rounded-full bg-[var(--nimi-action-primary-bg)]" style={{ animationDelay: '300ms' }} aria-hidden="true" />
    </div>
  );
}

export function AnimateIn({ children, className = '', delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const reducedMotion = useNimiReducedMotion();
  const baseTransition = reducedMotion ? nimiReducedFade() : nimiSpring('default');
  const transition = delay > 0 ? { ...baseTransition, delay: delay / 1000 } : baseTransition;

  return (
    <motion.div
      initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 10 }}
      animate={reducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
      transition={transition}
      className={className}
    >
      {children}
    </motion.div>
  );
}
