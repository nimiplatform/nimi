import assert from 'node:assert/strict';
import test from 'node:test';

import { MemoryCanonicalClass } from '../../../sdks/typescript/dist/runtime/wire-types/index.js';
import {
  buildConversationReportMemoryQuery,
  conversationReportMemoryCanonicalClasses,
} from './memory-capture.mjs';

test('report memory capture declares every bounded Runtime canonical read class', () => {
  assert.deepEqual(conversationReportMemoryCanonicalClasses, [
    MemoryCanonicalClass.PUBLIC_SHARED,
    MemoryCanonicalClass.WORLD_SHARED,
    MemoryCanonicalClass.DYADIC,
  ]);
  assert.deepEqual(buildConversationReportMemoryQuery({
    ownerUserId: 'owner', runtimeSourceRef: 'snapshot', localAgentRef: 'agent',
  }), {
    ownerUserId: 'owner',
    runtimeSourceRef: 'snapshot',
    localAgentRef: 'agent',
    query: '',
    limit: 20,
    canonicalClasses: [
      MemoryCanonicalClass.PUBLIC_SHARED,
      MemoryCanonicalClass.WORLD_SHARED,
      MemoryCanonicalClass.DYADIC,
    ],
  });
});
