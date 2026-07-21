import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const walletPageSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/settings/settings-advanced-panel.tsx'),
  'utf8',
);
const walletSectionsSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/settings/settings-wallet-sections.tsx'),
  'utf8',
);

test('Wallet page performs one-click Spark checkout and callback handling', () => {
  assert.match(walletPageSource, /createRealmCommerceGiftService/);
  assert.match(walletPageSource, /loadRealmSparkPackages\(\{ service: giftService \}\)/);
  assert.match(walletPageSource, /createRealmSparkCheckout\(\{\s*service: giftService,/s);
  assert.doesNotMatch(walletPageSource, /dataSync\.loadSparkPackages/);
  assert.doesNotMatch(walletPageSource, /dataSync\.createSparkCheckout/);
  assert.match(walletPageSource, /bindings\.app\.commands\.openWalletCheckout\(checkoutUrl\)/);
  assert.match(walletPageSource, /wallet_checkout/);
});

test('Wallet recharge button is gated by package readiness and launch state', () => {
  assert.match(
    walletSectionsSource,
    /disabled=\{packagesPending \|\| launchingRecharge \|\| !defaultSparkPackageAvailable\}/,
  );
});
