import { NimiElectronShellHostError } from './types.js';
import { normalizeRequiredToken } from './paths.js';
import type {
  NimiElectronHostCommandPolicy,
  NimiElectronHostCommandPolicyInput,
} from './types.js';

export async function assertElectronHostCommandPolicyAllowed(
  policy: NimiElectronHostCommandPolicy | undefined,
  input: NimiElectronHostCommandPolicyInput,
): Promise<void> {
  if (!policy) {
    return;
  }
  const decision = await policy(input);
  if (decision.allow) {
    return;
  }
  const reasonCode = normalizeRequiredToken(decision.reasonCode, 'commandPolicy.reasonCode');
  const actionHint = normalizeRequiredToken(decision.actionHint, 'commandPolicy.actionHint');
  throw new NimiElectronShellHostError({
    code: decision.code ?? 'capability-unavailable',
    message: `Electron host command policy denied command: ${input.command}`,
    reasonCode,
    actionHint,
    source: 'host',
    details: {
      command: input.command,
      commandKind: input.commandKind,
      ...decision.details,
    },
  });
}
