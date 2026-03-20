// Empty state — greeting + quick action cards for new conversation
// Per design.md §14

import { useTranslation } from 'react-i18next';
import { Lightbulb, BarChart3, PenLine } from 'lucide-react';

interface EmptyStateProps {
  agentName?: string;
  onQuickAction?: (prompt: string) => void;
}

const quickActions = [
  { icon: Lightbulb, key: 'writeCode' },
  { icon: BarChart3, key: 'analyzeData' },
  { icon: PenLine, key: 'writeCopy' },
] as const;

export function EmptyState({ agentName, onQuickAction }: EmptyStateProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center justify-center h-full" style={{ paddingBottom: '20%' }}>
      {/* Greeting */}
      <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center mb-5">
        <div className="w-3 h-3 rounded-full bg-accent" />
      </div>
      <h2 className="text-[20px] font-semibold mb-2 text-text-primary">
        {t('chat.greeting', { name: agentName || 'AI' })}
      </h2>
      <p className="text-[13px] text-text-secondary mb-8">
        {t('chat.greetingSub')}
      </p>

      {/* Quick action cards */}
      <div className="flex gap-3">
        {quickActions.map(({ icon: Icon, key }) => (
          <button
            key={key}
            onClick={() => onQuickAction?.(t(`chat.quickAction.${key}.prompt`))}
            className="flex flex-col items-center gap-2 px-5 py-4 rounded-xl bg-bg-elevated hover:bg-bg-surface border border-border-subtle hover:shadow-sm hover:-translate-y-0.5 transition-all duration-150 w-[140px]"
          >
            <Icon size={20} className="text-text-secondary" />
            <span className="text-[13px] text-text-secondary">
              {t(`chat.quickAction.${key}.label`)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
