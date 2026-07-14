import { delay } from './acceptance-files.mjs';

export async function readRuntimeAgentAIConfig(agentClient, identity) {
  return agentClient.agentAIConfig.get(identity);
}

function textGenerateTargetRefFromRuntimeAIConfig(snapshot) {
  const targetRef = snapshot?.intents?.['text.generate']?.targetRef;
  if (!targetRef || typeof targetRef !== 'object') {
    return null;
  }
  if (targetRef.kind === 'local-runtime' || targetRef.kind === 'cloud-connector') {
    return targetRef;
  }
  return null;
}

export async function waitForRuntimeTextGenerateTargetRef(agentClient, identity) {
  const deadline = Date.now() + 30_000;
  let lastSnapshot = null;
  while (Date.now() < deadline) {
    lastSnapshot = await readRuntimeAgentAIConfig(agentClient, identity);
    const targetRef = textGenerateTargetRefFromRuntimeAIConfig(lastSnapshot);
    if (targetRef) {
      return { targetRef, snapshot: lastSnapshot };
    }
    await delay(500);
  }
  return { targetRef: null, snapshot: lastSnapshot };
}
