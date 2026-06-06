/**
 * Create a private knowledge bank, write one page, search it, then delete it.
 * Run: npx tsx examples/sdk/advanced/knowledge.ts
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { createNimiClient } from '@nimiplatform/sdk';
import { KnowledgeBankScope, ReasonCode } from '@nimiplatform/sdk/runtime/generated';

const APP_ID = 'example.knowledge';
const SUBJECT_USER_ID = 'local-user';
const context = {
  appId: APP_ID,
  subjectUserId: SUBJECT_USER_ID,
};

const { runtime } = createNimiClient({
  appId: APP_ID,
  runtime: { transport: { type: 'node-grpc', endpoint: '127.0.0.1:46371' } },
});

const sourcePath = resolve(process.cwd(), 'README.md');
const sourceContent = await readFile(sourcePath, 'utf8');

const createBank = await runtime.knowledge.createKnowledgeBank({
  context,
  locator: {
    locator: {
      oneofKind: 'appPrivate',
      appPrivate: { appId: APP_ID },
    },
  },
  displayName: 'Nimi README',
});

const bank = createBank.bank;
if (!bank) {
  throw new Error('createKnowledgeBank returned no bank payload');
}

await runtime.knowledge.putPage({
  context,
  bankId: bank.bankId,
  pageId: '',
  slug: 'nimi-readme',
  title: 'Nimi README',
  content: sourceContent,
  entityType: 'document',
});

const search = await runtime.knowledge.searchKeyword({
  context,
  bankIds: [bank.bankId],
  query: 'What is Nimi?',
  topK: 3,
  entityTypeFilters: ['document'],
  slugPrefix: '',
});

console.log('bank:', bank.bankId, KnowledgeBankScope[bank.locator?.scope ?? KnowledgeBankScope.UNSPECIFIED]);
for (const hit of search.hits) {
  console.log(`${hit.pageId}: ${hit.score} ${hit.snippet}`);
}

const deleted = await runtime.knowledge.deleteKnowledgeBank({
  context,
  bankId: bank.bankId,
});

console.log('delete:', ReasonCode[deleted.ack?.reasonCode ?? ReasonCode.REASON_CODE_UNSPECIFIED]);
