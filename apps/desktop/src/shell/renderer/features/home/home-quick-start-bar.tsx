import { ArrowUp, Sparkles } from 'lucide-react';
import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

export type HomeQuickStartBarProps = {
  onSubmitDraft: (text: string) => void;
  onOpenChat: () => void;
};

// @nimi-authority: rule.nimi.desktop.product-surfaces.r015
export function HomeQuickStartBar({
  onSubmitDraft,
  onOpenChat,
}: HomeQuickStartBarProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const trimmed = draft.trim();
  const hasDraft = trimmed.length > 0;

  const commit = () => {
    if (!hasDraft) {
      onOpenChat();
      return;
    }
    const text = trimmed;
    setDraft('');
    onSubmitDraft(text);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    commit();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    commit();
  };

  const actionLabel = hasDraft
    ? t('runtimeConfig.overview.quickStart.submitDraft')
    : t('runtimeConfig.overview.openChat');

  return (
    <form
      onSubmit={handleSubmit}
      data-testid="home-quick-start-bar"
      className="group flex min-w-0 items-center gap-3 rounded-3xl bg-[var(--nimi-home-porcelain-card)] py-3 pr-3 pl-4 shadow-[var(--nimi-home-porcelain-pill-shadow)] transition-shadow duration-150 focus-within:shadow-[var(--nimi-home-porcelain-shadow-hover)] focus-within:ring-2 focus-within:ring-[var(--nimi-focus-ring-color)]/30"
    >
      <span
        className="flex size-9 shrink-0 items-center justify-center rounded-2xl bg-[var(--nimi-home-soft-well)] text-[var(--nimi-action-primary-bg)]"
        aria-hidden="true"
      >
        <Sparkles size={17} />
      </span>

      <textarea
        rows={1}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={t('runtimeConfig.overview.quickStart.placeholder')}
        aria-label={t('runtimeConfig.overview.quickStart.label')}
        data-testid="home-quick-start-input"
        className="max-h-28 min-w-0 flex-1 resize-none bg-transparent py-1.5 text-[15px] leading-6 text-[var(--nimi-text-primary)] placeholder:text-[var(--nimi-text-muted)] focus:outline-none"
      />

      <button
        type="submit"
        aria-label={actionLabel}
        title={actionLabel}
        data-testid="home-quick-start-submit"
        className={`flex size-9 shrink-0 items-center justify-center rounded-full transition-all duration-150 focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)] ${
          hasDraft
            ? 'bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)] shadow-[var(--nimi-elevation-base)] hover:opacity-90'
            : 'bg-[var(--nimi-home-soft-well)] text-[var(--nimi-text-secondary)] hover:bg-[var(--nimi-home-soft-well-hover)] hover:text-[var(--nimi-text-primary)]'
        }`}
      >
        <ArrowUp size={16} aria-hidden="true" />
      </button>
    </form>
  );
}
