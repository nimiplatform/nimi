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
    try { setValue(await client.snapshot()); }
    catch { setValue(null); setError(t('Workbench.utopia.readFailed')); }
    finally { setLoading(false); }
  }

  async function verifyWriteDenied() {
    if (!value) return;
    setLoading(true);
    setError('');
    try {
      await client.update({ expectedRevision: value.settings.revision, intent: { kind: 'outdoor', open: value.settings.outdoorOpen } });
      setError(t('Workbench.utopia.writeUnexpected'));
    } catch (failure) {
      const reason = failure && typeof failure === 'object' && 'reasonCode' in failure ? String(failure.reasonCode) : '';
      const code = reason.toLowerCase().replaceAll('_', '-');
      setError(/access-denied|permission-denied|local-app-operation-unavailable/u.test(code) ? t('Workbench.utopia.denied') : t('Workbench.utopia.writeFailed'));
    } finally { setLoading(false); }
  }

  return <section className="grid gap-3 p-5" aria-busy={loading}>
    <h2>{t('Workbench.utopia.title')}</h2>
    <div className="flex flex-wrap gap-2"><Button disabled={loading} onClick={() => void observe()}>{t('Workbench.utopia.read')}</Button>
      <Button tone="secondary" disabled={loading || !value} onClick={() => void verifyWriteDenied()}>{t('Workbench.utopia.checkWrite')}</Button></div>
    {error && <InlineAlert tone="info">{error}</InlineAlert>}
    {value && <pre className="max-h-[60vh] overflow-auto">{JSON.stringify(value, null, 2)}</pre>}
  </section>;
}
