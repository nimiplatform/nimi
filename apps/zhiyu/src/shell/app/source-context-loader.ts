import { requireZhiyuLocalAppCapability } from '../auth/runtime-platform';
import type { ZhiyuEvidence } from './evidence';

export async function loadZhiyuSourceContextProjection(identity: {
  readonly ownerUserId: string;
  readonly runtimeSourceRef: string;
  readonly localAgentRef: string;
  readonly conversationAnchorId: string;
}): Promise<ZhiyuEvidence['source']> {
  void identity;
  return requireZhiyuLocalAppCapability('source-context');
}
