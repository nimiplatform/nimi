import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import YAML from 'yaml';

import { generateProviderCatalog } from './generate-runtime-catalog.mjs';

const duplicateVideoFixture = path.join(
  import.meta.dirname,
  'fixtures',
  'runtime-catalog-duplicate-video-mode.source.yaml',
);

test('real catalog generator rejects duplicate canonical video modes from source YAML', () => {
  const source = YAML.parse(fs.readFileSync(duplicateVideoFixture, 'utf8'));
  assert.throws(
    () => generateProviderCatalog(source),
    /video_generation\.modes contains duplicate normalized mode: t2v/u,
  );
});
