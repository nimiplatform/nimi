/** Canonical JSON identities for replay-owned non-JSON schema declarations. */

import type { JsonValue } from './json-value.ts';
import type { SimulatorSchema } from './schema.ts';
import type { SimulatorStreamMethodDeclaration } from './engine-types.ts';

export interface SimulatorReplayStreamMethodIdentity {
  readonly methodId: string;
  readonly ownerModuleId: string;
  readonly sourceEventType: string;
  readonly terminalEventType: string | null;
  readonly itemSchema: JsonValue;
  readonly terminalSchema: JsonValue;
}

export function replaySchemaIdentity(schema: SimulatorSchema): JsonValue {
  switch (schema.kind) {
    case 'null':
    case 'boolean':
    case 'number':
    case 'json':
      return { kind: schema.kind };
    case 'integer':
      return {
        kind: schema.kind,
        minimum: schema.minimum ?? null,
        maximum: schema.maximum ?? null,
      };
    case 'string':
      return {
        kind: schema.kind,
        pattern: schema.pattern
          ? { source: schema.pattern.source, flags: schema.pattern.flags }
          : null,
        minLength: schema.minLength ?? null,
        maxLength: schema.maxLength ?? null,
      };
    case 'stringEnum':
      return { kind: schema.kind, values: [...schema.values] };
    case 'array':
      return {
        kind: schema.kind,
        items: replaySchemaIdentity(schema.items),
        minItems: schema.minItems ?? null,
        maxItems: schema.maxItems ?? null,
      };
    case 'object':
      return {
        kind: schema.kind,
        properties: Object.fromEntries(
          Object.entries(schema.properties)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, value]) => [key, replaySchemaIdentity(value)]),
        ),
        required: schema.required ? [...schema.required] : null,
      };
    case 'union':
      return { kind: schema.kind, variants: schema.variants.map(replaySchemaIdentity) };
  }
}

export function replayStreamMethodIdentity(
  declaration: SimulatorStreamMethodDeclaration,
): SimulatorReplayStreamMethodIdentity {
  return Object.freeze({
    methodId: declaration.methodId,
    ownerModuleId: declaration.ownerModuleId,
    sourceEventType: declaration.sourceEventType,
    terminalEventType: declaration.terminalEventType,
    itemSchema: replaySchemaIdentity(declaration.itemSchema),
    terminalSchema: replaySchemaIdentity(declaration.terminalSchema),
  });
}
