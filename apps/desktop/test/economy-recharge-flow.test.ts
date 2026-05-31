import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  createRealmSparkCheckout,
  loadRealmSparkPackages,
  type RealmCommerceGiftService,
} from '@nimiplatform/kit/features/commerce/realm';

const walletPageSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/settings/settings-advanced-panel.tsx'),
  'utf8',
);

test('Kit commerce realm helper behaviorally calls Spark recharge APIs', async () => {
  const capturedCalls: string[] = [];
  const service = {
    listSparkPackages: async () => {
      capturedCalls.push('list-packages');
      return [{ id: 'pkg-1', label: 'Starter', sparkAmount: 100, usdPrice: 1.99, popular: true }];
    },
    createSparkCheckout: async (input: Record<string, unknown>) => {
      capturedCalls.push(`checkout:${String(input.packageId || '')}`);
      return { sessionId: 'session-1', url: 'https://checkout.nimi.example/session-1' };
    },
  } as unknown as RealmCommerceGiftService;

  const packages = await loadRealmSparkPackages(service);
  const session = await createRealmSparkCheckout({
    packageId: 'pkg-1',
  } as never, service);

  assert.deepEqual(capturedCalls, ['list-packages', 'checkout:pkg-1']);
  assert.equal(Array.isArray(packages), true);
  assert.equal(packages[0]?.id, 'pkg-1');
  assert.equal(session.url, 'https://checkout.nimi.example/session-1');
});

test('Wallet page performs one-click Spark checkout and callback handling', () => {
  assert.match(walletPageSource, /loadRealmSparkPackages\(\)/);
  assert.match(walletPageSource, /createRealmSparkCheckout\(/);
  assert.doesNotMatch(walletPageSource, /dataSync\.loadSparkPackages/);
  assert.doesNotMatch(walletPageSource, /dataSync\.createSparkCheckout/);
  assert.match(walletPageSource, /desktopBridge\.openExternalUrl\(checkoutUrl\)/);
  assert.match(walletPageSource, /wallet_checkout/);
});

test('Wallet recharge button is gated by package readiness and launch state', () => {
  assert.match(
    walletPageSource,
    /disabled=\{sparkPackagesQuery\.isPending \|\| launchingRecharge \|\| !defaultSparkPackage\}/,
  );
});
