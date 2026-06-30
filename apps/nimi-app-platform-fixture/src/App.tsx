import { useMemo, useState } from 'react';
import { AppCardSurface, Button } from '@nimiplatform/kit/ui';
import { createInitialFixtureProof } from './proof.js';

export function App() {
  const [refreshCount, setRefreshCount] = useState(0);
  const proof = useMemo(() => createInitialFixtureProof(), [refreshCount]);

  return (
    <main className="min-h-screen bg-[var(--nimi-surface-canvas)] p-6 text-[var(--nimi-text-primary)]">
      <AppCardSurface className="mx-auto max-w-3xl p-5" data-testid="platform-fixture-proof">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-[var(--nimi-text-secondary)]">Nimi App Platform Fixture</p>
              <h1 className="text-2xl font-semibold">Installed App Ecosystem Probe</h1>
            </div>
            <Button tone="primary" size="sm" onClick={() => setRefreshCount((value) => value + 1)}>
              Refresh proof
            </Button>
          </div>

          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-[var(--nimi-text-tertiary)]">Track</dt>
              <dd className="font-medium">{proof.admissionTrack}</dd>
            </div>
            <div>
              <dt className="text-[var(--nimi-text-tertiary)]">Product readiness</dt>
              <dd className="font-medium">{String(proof.productReadinessClaimAllowed)}</dd>
            </div>
            <div>
              <dt className="text-[var(--nimi-text-tertiary)]">Scope owner</dt>
              <dd className="font-medium">{proof.scopeRef.ownerId}</dd>
            </div>
          </dl>

          <pre className="max-h-80 overflow-auto rounded-md bg-[var(--nimi-surface-panel)] p-3 text-xs" data-testid="platform-fixture-proof-json">
            {JSON.stringify(proof, null, 2)}
          </pre>
        </div>
      </AppCardSurface>
    </main>
  );
}
