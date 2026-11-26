import { useState } from 'react';
import { Button, InlineAlert, Surface } from '@nimiplatform/kit/ui';
import type { NimiUtopiaSnapshot, NimiLocalAppUtopiaClient } from '@nimiplatform/sdk/app';
import { useTranslation } from '../../shell/i18n/index.js';

export function LabUtopiaPage({ client }: { client: NimiLocalAppUtopiaClient }) {
  const { t } = useTranslation();
  const [value, setValue] = useState<NimiUtopiaSnapshot | null>(null);
  const [notice, setNotice] = useState<{ tone: 'info' | 'warning'; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function observe() {
    setLoading(true);
    setNotice(null);
    try {
      setValue(await client.snapshot());
    } catch {
      setValue(null);
      setNotice({ tone: 'warning', text: t('Workbench.utopia.readFailed') });
    } finally {
      setLoading(false);
    }
  }

  async function verifyWriteDenied() {
    if (!value) return;
    setLoading(true);
    setNotice(null);
    try {
      await client.update({
        expectedRevision: value.revision,
        intent: { kind: 'set-public-participation', enabled: value.publicParticipation },
      });
      setNotice({ tone: 'warning', text: t('Workbench.utopia.writeUnexpected') });
    } catch (failure) {
      const reason = failure && typeof failure === 'object' && 'reasonCode' in failure ? String(failure.reasonCode) : '';
      const code = reason.toLowerCase().replaceAll('_', '-');
      const denied = /access-denied|permission-denied|local-app-operation-unavailable/u.test(code);
      setNotice({
        tone: denied ? 'info' : 'warning',
        text: denied ? t('Workbench.utopia.denied') : t('Workbench.utopia.writeFailed'),
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="lab-workspace-route">
      <section className="mx-auto grid max-w-5xl gap-3" aria-busy={loading}>
        <h1 className="m-0 text-xl font-semibold text-[var(--nimi-text-primary)]">{t('Workbench.utopia.title')}</h1>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={loading} onClick={() => void observe()}>{t('Workbench.utopia.read')}</Button>
          <Button size="sm" tone="secondary" disabled={loading || !value} onClick={() => void verifyWriteDenied()}>{t('Workbench.utopia.checkWrite')}</Button>
        </div>
        {notice && <InlineAlert tone={notice.tone}>{notice.text}</InlineAlert>}
        {value && (
          <div className="grid gap-3">
            <Surface tone="card" padding="sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <strong>{value.habitat.title}</strong>
                <span className="text-xs text-[var(--nimi-text-muted)]">
                  {value.habitat.habitatId} · {value.habitat.themeTag} · {value.timezone} · r{value.revision}
                </span>
              </div>
              <p className="mt-1 text-sm text-[var(--nimi-text-secondary)]">{value.habitat.backdropSummary}</p>
            </Surface>
            <div className="grid gap-3 md:grid-cols-2">
              <Surface tone="card" padding="sm" className="text-sm">
                <h2 className="m-0 text-sm font-medium">{t('Workbench.utopia.places')}</h2>
                <ul className="mt-1 grid gap-1">
                  {value.habitat.places.map((place) => (
                    <li key={place.id}>
                      <span>{place.name}</span>{' '}
                      <span className="text-xs text-[var(--nimi-text-muted)]">
                        ({place.archetype} · {value.openPlaceIds.includes(place.id) ? 'open' : 'closed'})
                      </span>
                    </li>
                  ))}
                </ul>
              </Surface>
              <Surface tone="card" padding="sm" className="text-sm">
                <h2 className="m-0 text-sm font-medium">{t('Workbench.utopia.parameters')}</h2>
                <ul className="mt-1 grid gap-1">
                  {value.habitat.parameters.map((param) => (
                    <li key={param.key}>
                      <span>{param.label}: </span>
                      <code>{value.parameterValues[param.key] ?? param.defaultValue}</code>
                    </li>
                  ))}
                </ul>
                {value.activeEvents.length > 0 && (
                  <div className="mt-2">
                    <h3 className="m-0 text-sm font-medium">{t('Workbench.utopia.activeEvents')}</h3>
                    <ul className="mt-1 grid gap-1">
                      {value.activeEvents.map((ev) => (
                        <li key={ev.eventId}>{ev.label} ({ev.sceneryKind})</li>
                      ))}
                    </ul>
                  </div>
                )}
              </Surface>
            </div>
            {value.residents.length > 0 && (
              <Surface tone="card" padding="sm" className="text-sm">
                <h2 className="m-0 text-sm font-medium">{t('Workbench.utopia.residents')}</h2>
                <ul className="mt-1 grid gap-1">
                  {value.residents.map((resident) => (
                    <li key={resident.agentHandle}>
                      <strong>{resident.displayName}</strong>
                      {resident.current ? ` — ${resident.current.title}${resident.current.placeLabel ? ` · ${resident.current.placeLabel}` : ''}` : ''}
                    </li>
                  ))}
                </ul>
              </Surface>
            )}
            {value.sharedActivities.length > 0 && (
              <Surface tone="card" padding="sm" className="text-sm">
                <h2 className="m-0 text-sm font-medium">{t('Workbench.utopia.sharedActivities')}</h2>
                <ul className="mt-1 grid gap-1">
                  {value.sharedActivities.map((act) => (
                    <li key={act.activityRef}>
                      {act.activityLabel} · {act.placeLabel} ({act.habitatTitle}) — <code>{act.state}</code>
                    </li>
                  ))}
                </ul>
              </Surface>
            )}
            <Surface tone="card" padding="sm" className="text-xs">
              <details>
                <summary className="cursor-pointer font-medium text-[var(--nimi-text-secondary)]">{t('Workbench.utopia.rawSnapshot')}</summary>
                <pre className="mt-2 max-h-[50vh] overflow-auto text-[var(--nimi-text-secondary)]">{JSON.stringify(value, null, 2)}</pre>
              </details>
            </Surface>
          </div>
        )}
      </section>
    </div>
  );
}
