import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { seedAvatarProductSmokeAgentCenterConfig } from '../scripts/run-macos-smoke-avatar-product.mjs';

function mkdirTemp(prefix: string) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('Avatar product smoke seeds Agent Center config under product control data root', () => {
  const tempRoot = mkdirTemp('nimi-avatar-product-seed-');
  const sampleRoot = path.join(tempRoot, 'sample-live2d');
  const packageRoot = path.join(tempRoot, 'product-package');
  const dataRoot = path.join(tempRoot, 'selected-product-data');
  fs.mkdirSync(sampleRoot, { recursive: true });
  fs.mkdirSync(packageRoot, { recursive: true });
  fs.writeFileSync(path.join(sampleRoot, 'Ren.model3.json'), JSON.stringify({
    Version: 3,
    FileReferences: {},
  }));

  const seeded = seedAvatarProductSmokeAgentCenterConfig({
    packageRoot,
    sampleRoot,
    modelFilename: 'Ren.model3.json',
  }, {
    dataRoot: {
      path: dataRoot,
    },
  });

  assert.ok(seeded, 'seed result is required');
  assert.equal(seeded.dataDir, dataRoot);
  assert.equal(seeded.accountId, 'user-e2e-primary');
  assert.equal(seeded.localAgentRef, 'local-agent:user-e2e-primary:agent-e2e-alpha');
  assert.ok(seeded.configPath.startsWith(`${dataRoot}${path.sep}`));

  const config = JSON.parse(fs.readFileSync(seeded.configPath, 'utf8')) as {
    modules?: {
      avatar_asset?: {
        local_avatar_asset_ref?: string | null;
        backend_capability_profile_ref?: string | null;
      };
    };
  };
  assert.equal(config.modules?.avatar_asset?.local_avatar_asset_ref, seeded.avatarAssetRef);
  assert.match(config.modules?.avatar_asset?.local_avatar_asset_ref || '', /^live2d_[0-9a-f]{12}$/u);
  assert.match(config.modules?.avatar_asset?.backend_capability_profile_ref || '', /^avatar_profile_live2d_[0-9a-f]{12}$/u);
});
