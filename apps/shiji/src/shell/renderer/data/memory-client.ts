/**
 * memory-client.ts — Realm API: agent dyadic memory
 * Uses AgentsService (SDK-generated) per feature-matrix.yaml dialogue-session
 * Note: SJ-DIAL-002 — agent memory records what the character remembers about
 * this student; distinct from local learner_context_notes (pedagogical app state)
 * Full typed implementation: Phase 1 Step 1.5
 */
import { getPlatformClient } from '@nimiplatform/sdk';
import type { RealmServiceArgs } from '@nimiplatform/sdk/realm';

type CommitMemoryBody = RealmServiceArgs<'AgentsService', 'agentControllerCommitMemory'>[1];

export async function recallAgentMemory(agentId: string, learnerId: string): Promise<unknown> {
  // GET /api/agent/accounts/{id}/memory/dyadic/{userId} — AgentsService.agentControllerListDyadicMemories
  return getPlatformClient().realm.services.AgentsService.agentControllerListDyadicMemories(agentId, learnerId);
}

export async function writeAgentMemory(agentId: string, learnerId: string, memoryText: string): Promise<void> {
  // POST /api/agent/accounts/{id}/memory/commits — AgentsService.agentControllerCommitMemory
  // commit is required by CommitAgentMemoryDto; callers must supply it via the typed extension
  // commitAgentMemories() from @nimiplatform/sdk/realm for full envelope construction.
  // This stub fixes positional arg signature; commit envelope must be wired before production use.
  const body: CommitMemoryBody = {
    content: memoryText,
    type: 'DYADIC',
    userId: learnerId,
  } as CommitMemoryBody;
  await getPlatformClient().realm.services.AgentsService.agentControllerCommitMemory(agentId, body);
}
