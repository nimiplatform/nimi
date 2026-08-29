import type { NimiLocalAppClient, NimiLocalAppTextCandidateInput } from '@nimiplatform/sdk/app';

export type DesktopNimiTextCapabilityResult = {
  readonly text: string;
  readonly traceId: string | null;
};

export type DesktopNimiTextCapabilityInput = {
  readonly client: Pick<NimiLocalAppClient, 'ai'>;
  readonly prompt: string;
  readonly signal?: AbortSignal;
};

/** Builds only bounded App input; Runtime owns route, implementation and target. */
export function buildDesktopNimiTextCapabilityRequest(
  input: DesktopNimiTextCapabilityInput,
): NimiLocalAppTextCandidateInput {
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error('Nimi Chat text input is required.');
  return Object.freeze({
    messages: Object.freeze([{ role: 'user' as const, text: prompt }]),
  });
}

/** Executes Nimi Chat through Desktop's canonical formal App client. */
export async function runDesktopNimiTextCapability(
  input: DesktopNimiTextCapabilityInput,
): Promise<DesktopNimiTextCapabilityResult> {
  if (input.signal?.aborted) throw input.signal.reason;
  const result = await input.client.ai.text.generateCandidate(
    buildDesktopNimiTextCapabilityRequest(input),
  );
  if (input.signal?.aborted) throw input.signal.reason;
  return {
    text: result.text,
    traceId: result.traceId.trim() || null,
  };
}
