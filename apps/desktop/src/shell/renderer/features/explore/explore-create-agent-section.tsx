import { useTranslation } from 'react-i18next';
import { Surface } from '@nimiplatform/nimi-kit/ui';

// Explore "Create Agent" section. T5-1 scope: this section only describes the
// canonical creation entry point (Explore -> World detail -> Create Agent, per
// D-EXPL-008). The conditional creation affordance lives inside World detail
// and is gated on worldAdmitsUserCreatedRealmAgents. The 3-mode draft-review
// creation flow itself is wave T5-3 and is not implemented here.
export function ExploreCreateAgentSection({
  onBrowseWorlds,
}: {
  onBrowseWorlds: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Surface
      tone="card"
      material="glass-regular"
      elevation="base"
      className="rounded-[2rem] border-white/70 p-8"
      data-testid="explore-create-agent-section"
    >
      <div className="mx-auto flex max-w-xl flex-col items-center gap-4 text-center">
        <div
          className="grid h-14 w-14 place-items-center rounded-2xl"
          style={{
            background: 'var(--nimi-accent-soft)',
            color: 'var(--nimi-accent)',
          }}
        >
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </div>
        <h3
          className="m-0"
          style={{
            fontFamily: 'var(--nimi-font-display)',
            fontSize: 22,
            fontWeight: 600,
            letterSpacing: '-0.02em',
            color: 'var(--nimi-fg-1)',
          }}
        >
          {t('Explore.createAgentHeading', { defaultValue: 'Create a RealmAgent' })}
        </h3>
        <p
          className="m-0"
          style={{
            fontFamily: 'var(--nimi-font-sans)',
            fontSize: 14,
            lineHeight: 1.6,
            color: 'var(--nimi-fg-3)',
          }}
        >
          {t('Explore.createAgentBody', {
            defaultValue:
              'RealmAgents are always created inside a World. Open a World from the Worlds section, then use its Create Agent affordance. The affordance only appears for Worlds that admit user-created RealmAgents.',
          })}
        </p>
        <button
          type="button"
          onClick={onBrowseWorlds}
          className="mt-2 inline-flex items-center gap-2 rounded-full px-5 py-2.5 transition-colors"
          style={{
            fontFamily: 'var(--nimi-font-sans)',
            fontSize: 13,
            fontWeight: 600,
            background: 'var(--nimi-accent)',
            color: 'var(--nimi-accent-onAccent)',
            border: '1px solid color-mix(in srgb, var(--nimi-accent) 80%, transparent)',
            boxShadow: 'var(--nimi-elevation-base)',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
          {t('Explore.createAgentCta', { defaultValue: 'Browse Worlds' })}
        </button>
      </div>
    </Surface>
  );
}
