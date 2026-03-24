import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  createSparkCheckout,
  loadSparkPackages,
} from '../src/runtime/data-sync/flows/economy-notification-flow';

const facadeActionsSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/runtime/data-sync/facade-actions.ts'),
  'utf8',
);
const facadeSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/runtime/data-sync/facade.ts'),
  'utf8',
);
const walletPageSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/settings/settings-advanced-panel.tsx'),
  'utf8',
);

test('economy data-sync flow behaviorally calls Spark recharge APIs', async () => {
  const capturedCalls: string[] = [];
  const callApi = async <T>(task: (realm: unknown) => Promise<T>): Promise<T> =>
    task({
      services: {
        EconomyCurrencyGiftsService: {
          economyControllerGetSparkPackages: async () => {
            capturedCalls.push('list-packages');
            return [{ id: 'pkg-1', label: 'Starter', sparkAmount: 100, usdPrice: 1.99, popular: true }];
          },
          economyControllerCreateSparkCheckout: async (input: Record<string, unknown>) => {
            capturedCalls.push(`checkout:${String(input.packageId || '')}`);
            return { checkoutUrl: 'https://checkout.nimi.example/session-1' };
          },
        },
      },
    });
  const emitDataSyncError = () => undefined;

  const packages = await loadSparkPackages(callApi as never, emitDataSyncError);
  const session = await createSparkCheckout(callApi as never, emitDataSyncError, {
    packageId: 'pkg-1',
  } as never);

  assert.deepEqual(capturedCalls, ['list-packages', 'checkout:pkg-1']);
  assert.equal(Array.isArray(packages), true);
  assert.equal(packages[0]?.id, 'pkg-1');
  assert.equal(String((session as { checkoutUrl?: string }).checkoutUrl || ''), 'https://checkout.nimi.example/session-1');
});

test('DataSync actions and facade wire Spark recharge methods', () => {
  assert.match(facadeActionsSource, /loadSparkPackages: async \(\) =>/);
  assert.match(facadeActionsSource, /createSparkCheckout: async \(payload: CreateSparkCheckoutDto\) =>/);

  assert.match(facadeSource, /loadSparkPackages\(\): Promise<SparkPackageDto\[]>/);
  assert.match(facadeSource, /createSparkCheckout\(payload: CreateSparkCheckoutDto\): Promise<SparkCheckoutSessionDto>/);
});

test('Wallet page performs one-click Spark checkout and callback handling', () => {
  assert.match(walletPageSource, /dataSync\.loadSparkPackages\(\)/);
  assert.match(walletPageSource, /dataSync\.createSparkCheckout\(/);
  assert.match(walletPageSource, /desktopBridge\.openExternalUrl\(checkoutUrl\)/);
  assert.match(walletPageSource, /wallet_checkout/);
});

test('Wallet recharge button is gated by package readiness and launch state', () => {
  assert.match(
    walletPageSource,
    /disabled=\{sparkPackagesQuery\.isPending \|\| launchingRecharge \|\| !defaultSparkPackage\}/,
  );
});
