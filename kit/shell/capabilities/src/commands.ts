import { createNimiStandardShellError } from './errors.js';
import { NIMI_STANDARD_SHELL_CAPABILITIES, type NimiStandardShellCapabilityId } from './catalog.js';

type NimiStandardShellCatalogEntry = (typeof NIMI_STANDARD_SHELL_CAPABILITIES)[number];
type NimiStandardShellCommandKeyFor<Capability extends NimiStandardShellCatalogEntry> =
  `${Capability['id']}.${Capability['operations'][number]['id']}`;

export type NimiStandardShellCommandKey = NimiStandardShellCommandKeyFor<NimiStandardShellCatalogEntry>;

export const NIMI_STANDARD_SHELL_COMMANDS = Object.freeze(
  Object.fromEntries(
    NIMI_STANDARD_SHELL_CAPABILITIES.flatMap((capability) =>
      capability.operations.map((operation) => [`${capability.id}.${operation.id}`, operation.command]),
    ),
  ) as Record<NimiStandardShellCommandKey, string>,
);

export function getNimiStandardShellCommand(capabilityId: NimiStandardShellCapabilityId, operationId: string): string {
  const capability = NIMI_STANDARD_SHELL_CAPABILITIES.find((entry) => entry.id === capabilityId);
  const operation = capability?.operations.find((entry) => entry.id === operationId);
  if (!operation) {
    throw createNimiStandardShellError({
      code: 'invalid-payload',
      reasonCode: 'unknown-standard-shell-operation',
      actionHint: 'Use an operation id declared by standard-shell-capabilities.yaml.',
      source: 'host',
      details: { capabilityId, operationId },
    });
  }
  return operation.command;
}
