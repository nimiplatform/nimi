import { useState } from 'react';
import { Button, InlineAlert } from '@nimiplatform/kit/ui';
import type { NimiUtopiaSnapshot, NimiLocalAppUtopiaClient } from '@nimiplatform/sdk/app';
import { useTranslation } from '../../shell/i18n/index.js';

export function LabUtopiaPage({ client }: { client: NimiLocalAppUtopiaClient }) {
  const { t } = useTranslation();
  const [value, setValue] = useState<NimiUtopiaSnapshot | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function observe() {
    setLoading(true);
    setError('');
    try {
      setValue(await client.snapshot());
    } catch {
      setValue(null);
      setError(t('Workbench.utopia.readFailed'));
    } finally {
      setLoading(false);
    }
  }

  async function verifyWriteDenied() {
    if (!value) return;
    setLoading(true);
    setError('');
    try {
      await client.update({
        expectedRevision: value.revision,
        intent: { kind: 'set-public-participation', enabled: value.publicParticipation },
      });
      setError(t('Workbench.utopia.writeUnexpected'));
    } catch (failure) {
      const reason = failure && typeof failure === 'object' && 'reasonCode' in failure ? String(failure.reasonCode) : '';
      const code = reason.toLowerCase().replaceAll('_', '-');
      setError(/access-denied|permission-denied|local-app-operation-unavailable/u.test(code)
        ? t('Workbench.utopia.denied')
        : t('Workbench.utopia.writeFailed'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="grid gap-3 p-5" aria-busy={loading}>
      <h2>{t('Workbench.utopia.title')}</h2>
      <div className="flex flex-wrap gap-2">
        <Button disabled={loading} onClick={() => void observe()}>{t('Workbench.utopia.read')}</Button>
        <Button tone="secondary" disabled={loading || !value} onClick={() => void verifyWriteDenied()}>{t('Workbench.utopia.checkWrite')}</Button>
      </div>
      {error && <InlineAlert tone="info">{error}</InlineAlert>}
      {value && (
        <div className="grid gap-3">
          <div className="rounded border p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <strong>{value.habitat.title}</strong>
              <span className="text-xs opacity-75">
                {value.habitat.habitatId} · {value.habitat.themeTag} · {value.timezone} · r{value.revision}
              </span>
            </div>
            <p className="mt-1 text-sm opacity-85">{value.habitat.backdropSummary}</p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded border p-3 text-sm">
              <h3 className="font-medium">{t('Workbench.utopia.places')}</h3>
              <ul className="mt-1 grid gap-1">
                {value.habitat.places.map((place) => (
                  <li key={place.id}>
                    <span>{place.name}</span>{' '}
                    <span className="text-xs opacity-70">
                      ({place.archetype} · {value.openPlaceIds.includes(place.id) ? 'open' : 'closed'})
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded border p-3 text-sm">
              <h3 className="font-medium">{t('Workbench.utopia.parameters')}</h3>
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
                  <h4 className="font-medium">{t('Workbench.utopia.activeEvents')}</h4>
                  <ul className="mt-1 grid gap-1">
                    {value.activeEvents.map((ev) => (
                      <li key={ev.eventId}>{ev.label} ({ev.sceneryKind})</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
          {value.residents.length > 0 && (
            <div className="rounded border p-3 text-sm">
              <h3 className="font-medium">{t('Workbench.utopia.residents')}</h3>
              <ul className="mt-1 grid gap-1">
                {value.residents.map((resident) => (
                  <li key={resident.agentHandle}>
                    <strong>{resident.displayName}</strong>
                    {resident.current ? ` — ${resident.current.title}${resident.current.placeLabel ? ` · ${resident.current.placeLabel}` : ''}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {value.sharedActivities.length > 0 && (
            <div className="rounded border p-3 text-sm">
              <h3 className="font-medium">{t('Workbench.utopia.sharedActivities')}</h3>
              <ul className="mt-1 grid gap-1">
                {value.sharedActivities.map((act) => (
                  <li key={act.activityRef}>
                    {act.activityLabel} · {act.placeLabel} ({act.habitatTitle}) — <code>{act.state}</code>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <details className="rounded border p-3 text-xs">
            <summary className="cursor-pointer font-medium">{t('Workbench.utopia.rawSnapshot')}</summary>
            <pre className="mt-2 max-h-[50vh] overflow-auto">{JSON.stringify(value, null, 2)}</pre>
          </details>
        </div>
      )}
    </section>
  );
}
