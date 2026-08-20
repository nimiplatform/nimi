import { describeCharacterPrimaryAction } from '../explore/character-source-materialization';

export function ScoreProgressBar({ score = 0 }: { score?: number }) {
  const percentage = Math.min(100, Math.max(0, score));

  return (
    <div className="flex-1 h-2 bg-[var(--nimi-status-neutral-soft-bg)] rounded-full overflow-hidden">
      <div
        className="h-full rounded-full"
        style={{
          width: `${percentage}%`,
          background: 'linear-gradient(90deg, var(--nimi-action-primary-bg), var(--nimi-color-indigo))',
        }}
      />
    </div>
  );
}

export function SourceDetailPrimaryActionIcon({
  action: _action,
}: {
  action: ReturnType<typeof describeCharacterPrimaryAction>['action'];
}) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </svg>
  );
}
