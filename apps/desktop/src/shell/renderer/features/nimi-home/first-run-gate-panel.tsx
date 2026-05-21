import { useEffect, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollArea, Surface } from '@nimiplatform/nimi-kit/ui';
import { desktopBridge, type ProductControlRecordProjection } from '@renderer/bridge';
import { ProductControlWorkflow } from '../../first-run/index.js';
import { SupportDegradedEntry } from '../support/support-degraded-entry.js';

function useProductControlRecord(): {
  projection: ProductControlRecordProjection | null;
  setProjection: (projection: ProductControlRecordProjection) => void;
} {
  const [projection, setProjection] = useState<ProductControlRecordProjection | null>(null);

  useEffect(() => {
    let cancelled = false;
    void desktopBridge.getProductControlRecord().then((next) => {
      if (!cancelled) setProjection(next);
    }).catch((error) => {
      if (!cancelled) {
        setProjection({
          path: '',
          exists: false,
          state: 'repair_required',
          record: null,
          error: error instanceof Error ? error.message : 'product control record unavailable',
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return { projection, setProjection };
}

export function FirstRunGatePanel(): ReactElement {
  const { t } = useTranslation();
  const { projection, setProjection } = useProductControlRecord();

  return (
    <div data-testid="first-run-gate-panel" className="flex min-h-0 flex-1 flex-col">
      <ScrollArea
        className="flex-1"
        viewportClassName="bg-transparent"
        contentClassName="mx-auto flex w-full max-w-4xl flex-col gap-5 px-5 py-5"
      >
        <header className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold uppercase text-[var(--nimi-text-secondary)]">{t('FirstRun.gateEyebrow', { defaultValue: 'Nimi' })}</p>
            <h1 className="text-3xl font-semibold text-[var(--nimi-text-primary)]">{t('FirstRun.gateTitle', { defaultValue: 'First run setup' })}</h1>
          </div>
          {/* D-SUP-008: Support (repair + recovery) stays reachable from the
              degraded first-run / repair gate, not only the ready shell. */}
          <SupportDegradedEntry />
        </header>
        <Surface tone="panel" material="glass-regular" padding="none" className="min-h-[258px] p-5 shadow-[0_16px_44px_rgba(15,23,42,0.06)]">
          <ProductControlWorkflow projection={projection} onProjectionChange={setProjection} />
        </Surface>
      </ScrollArea>
    </div>
  );
}
