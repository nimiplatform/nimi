/**
 * Build and query a lightweight knowledge index.
 * Run: npx tsx examples/sdk/advanced/knowledge.ts
 */

import { resolve } from 'node:path';

import { createPlatformClient } from '@nimiplatform/sdk';

const { runtime } = await createPlatformClient({
  appId: 'example.knowledge',
  runtimeTransport: { type: 'node-grpc', endpoint: '127.0.0.1:46371' },
});

const indexId = 'docs.nimi';
const sourcePath = resolve(process.cwd(), 'README.md');

const build = await runtime.knowledge.buildIndex({
  appId: runtime.appId,
  subjectUserId: 'local-user',
  indexId,
  sourceKind: 'documents',
  sourceUris: [sourcePath],
  embeddingModelId: 'local/text-embedding-3-small',
  overwrite: true,
});

console.log('build:', build.taskId, build.accepted);

const search = await runtime.knowledge.searchIndex({
  appId: runtime.appId,
  subjectUserId: 'local-user',
  indexId,
  query: 'What is Nimi?',
  topK: 3,
});

for (const hit of search.hits) {
  console.log(`${hit.documentId}: ${hit.score} ${hit.snippet}`);
}
