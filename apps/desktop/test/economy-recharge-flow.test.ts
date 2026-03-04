import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const economyFlowSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/runtime/data-sync/flows/economy-notification-flow.ts'),
  'utf8',
);
const facadeActionsSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/runtime/data-sync/facade-actions.ts'),
  'utf8',
);
const facadeSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/runtime/data-sync/facade.ts'),
  'utf8',
);
const walletPageSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/settings/panels/advanced-panel.tsx'),
  'utf8',
);

test('economy data-sync flow exposes Spark recharge API calls', () => {
  assert.match(economyFlowSource, /export async function loadSparkPackages\(/);
  assert.match(economyFlowSource, /economyControllerGetSparkPackages\(\)/);

  assert.match(economyFlowSource, /export async function createSparkCheckout\(/);
  assert.match(economyFlowSource, /economyControllerCreateSparkCheckout\(input\)/);
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
