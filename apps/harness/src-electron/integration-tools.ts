import { setTimeout as delay } from 'node:timers/promises';
import { textPreview } from './text-preview.js';
import { defineExtension, defineTool } from '@earendil-works/pi-durable';
import { map, obj, opt, str, unknown } from '@earendil-works/pi-schema';
import type { NimiElectronAppBusinessServices } from '@nimiplatform/kit/shell/electron/main';

type Client = NimiElectronAppBusinessServices['integration'];
type Call = Awaited<ReturnType<Client['getCall']>>;

export type GrantedIntegrationSummary = {
  targetRef: string;
  integrationId: string;
  displayName: string;
  available: boolean;
  operations: {
    name: string;
    displayName: string;
    description: string;
    effect: 'read' | 'write';
  }[];
};

function receipt(call: Call) {
  const details = { callId: call.callId, status: call.status };
  if (call.status !== 'completed') {
    const text = JSON.stringify({ ...details, ...(call.errorCode ? { errorCode: call.errorCode } : {}) });
    return { output: [{ type: 'text' as const, text }], details };
  }
  const preview = textPreview(call.resultJson);
  return { output: [{ type: 'text' as const, text: JSON.stringify({
    ...details, resultText: preview.text, truncated: preview.truncated,
  }) }], details };
}

function isOwnHarnessSessionProvider(integrationId: string): boolean {
  return integrationId === 'ai.nimi.harness.sessions' || integrationId.startsWith('ai.nimi.harness.sessions.');
}

export async function listGrantedIntegrations(client: Client | undefined, signal: AbortSignal): Promise<GrantedIntegrationSummary[]> {
  signal.throwIfAborted();
  if (!client?.listCatalog) return [];
  const targets = await client.listCatalog();
  signal.throwIfAborted();
  return targets
    .filter(target => !isOwnHarnessSessionProvider(target.integrationId))
    .map(target => ({
      targetRef: target.targetRef,
      integrationId: target.integrationId,
      displayName: target.displayName,
      available: target.available,
      operations: target.operations
        .filter(op => (op.effect === 'read' || op.effect === 'write') && target.permittedOperations.includes(op.name))
        .map(op => ({
          name: op.name,
          displayName: op.displayName || op.name,
          description: op.description || '',
          effect: op.effect as 'read' | 'write',
        })),
    }))
    .filter(target => target.operations.length > 0);
}

export async function lookupIntegrationOperation(
  client: Client | undefined,
  targetRef: unknown,
  operation: unknown,
  signal: AbortSignal,
): Promise<{ displayName: string; operationDisplayName: string; effect: 'read' | 'write' } | undefined> {
  if (!client?.listCatalog || typeof targetRef !== 'string' || typeof operation !== 'string') return undefined;
  signal.throwIfAborted();
  try {
    const targets = await client.listCatalog();
    signal.throwIfAborted();
    const target = targets.find(t => t.targetRef === targetRef && !isOwnHarnessSessionProvider(t.integrationId));
    const op = target?.operations.find(item => item.name === operation);
    if (!target || !op || (op.effect !== 'read' && op.effect !== 'write')) return undefined;
    return { displayName: target.displayName, operationDisplayName: op.displayName || op.name, effect: op.effect };
  } catch {
    return undefined;
  }
}

async function dispatchAndObserve(client: Client, targetRef: string, operation: string, input: Record<string, unknown>, signal: AbortSignal) {
  let call = await client.invoke({ targetRef, operation, inputJson: JSON.stringify(input) });
  const until = Date.now() + 5000;
  while (call.status === 'accepted' && Date.now() < until) {
    await delay(350, undefined, { signal });
    try { call = await client.getCall({ callId: call.callId }); }
    catch {
      signal.throwIfAborted();
      // Acceptance was observed. Keep the receipt even when the subsequent lookup failed.
      return { ...receipt(call), output: [{ type: 'text' as const, text: JSON.stringify({
        callId: call.callId, status: 'accepted', observation: 'unavailable',
      }) }] };
    }
  }
  signal.throwIfAborted();
  return receipt(call);
}

export function integrationTools(client: Client, account: AbortSignal) {
  return defineExtension({ name: 'nimi-harness.integration-reads', tools: [
    defineTool({
      name: 'find_nimi_reads', description: 'Find available read operations already granted to this app in Nimi Home. Narrow your search if more matches exist. Results include the exact input schema.',
      parameters: obj({ query: opt(str({ description: 'Part of the connection name, operation name, or operation description.' })) }),
      replay: 'safe',
      async execute({ query }, _api, context) {
        const signal = context.abortSignal ? AbortSignal.any([context.abortSignal, account]) : account;
        signal.throwIfAborted();
        const targets = await client.listCatalog();
        signal.throwIfAborted();
        const search = (query ?? '').trim().toLowerCase();
        const items = [];
        let bytes = 0;
        let more = false;
        catalog: for (const target of targets) {
          if (!target.available || isOwnHarnessSessionProvider(target.integrationId)) continue;
          for (const op of target.operations) {
            if (op.effect !== 'read' || !target.permittedOperations.includes(op.name)) continue;
            if (![target.displayName, op.name, op.displayName, op.description].some(value => value?.toLowerCase().includes(search))) continue;
            const size = Buffer.byteLength(op.inputSchemaJson);
            if (items.length && (bytes + size > 65536 || items.length >= 8)) { more = true; break catalog; }
            items.push({ targetRef: target.targetRef, connection: target.displayName, operation: op.name,
              description: op.description, inputSchema: JSON.parse(op.inputSchemaJson) });
            bytes += size;
          }
        }
        return { output: [{ type: 'text', text: JSON.stringify({ items, more }) }] };
      },
    }),
    defineTool({
      name: 'read_nimi_integration', description: 'Read from a connected service using a target and operation returned by find_nimi_reads. Show the user the source and arguments for approval. An accepted call has no final result yet. Check its callId instead of submitting it again.',
      parameters: obj({ targetRef: str(), operation: str(), input: map(unknown()) }),
      replay: 'unsafe',
      async execute({ targetRef, operation, input }, _api, context) {
        const signal = context.abortSignal ? AbortSignal.any([context.abortSignal, account]) : account;
        signal.throwIfAborted();
        const target = (await client.listCatalog()).find(t => t.targetRef === targetRef && t.available && !isOwnHarnessSessionProvider(t.integrationId));
        if (!target?.permittedOperations.includes(operation) || !target.operations.some(op => op.name === operation && op.effect === 'read')) {
          throw new Error('This read operation is unavailable or is not granted to Harness in Home.');
        }
        signal.throwIfAborted();
        return dispatchAndObserve(client, targetRef, operation, input, signal);
      },
    }),
    defineTool({
      name: 'find_nimi_integrations',
      description: 'Find available read and write operations granted to Nimi Harness in Nimi Home. Returns target display name, effect (read or write), description, and exact input schema.',
      parameters: obj({
        query: opt(str({ description: 'Part of the connection name, operation name, or description.' })),
        effect: opt(str({ description: 'Optional filter: "read", "write", or "all".' })),
      }),
      replay: 'safe',
      async execute({ query, effect }, _api, context) {
        const signal = context.abortSignal ? AbortSignal.any([context.abortSignal, account]) : account;
        signal.throwIfAborted();
        const targets = await client.listCatalog();
        signal.throwIfAborted();
        const search = (query ?? '').trim().toLowerCase();
        const effectFilter = effect === 'read' || effect === 'write' ? effect : undefined;
        const items = [];
        let bytes = 0;
        let more = false;
        catalog: for (const target of targets) {
          if (!target.available || isOwnHarnessSessionProvider(target.integrationId)) continue;
          for (const op of target.operations) {
            if ((op.effect !== 'read' && op.effect !== 'write') || !target.permittedOperations.includes(op.name)) continue;
            if (effectFilter && op.effect !== effectFilter) continue;
            if (search && ![target.displayName, op.name, op.displayName, op.description].some(value => value?.toLowerCase().includes(search))) continue;
            const size = Buffer.byteLength(op.inputSchemaJson);
            if (items.length && (bytes + size > 65536 || items.length >= 16)) { more = true; break catalog; }
            items.push({
              targetRef: target.targetRef,
              connection: target.displayName,
              displayName: target.displayName,
              operation: op.name,
              operationDisplayName: op.displayName || op.name,
              effect: op.effect,
              description: op.description,
              inputSchema: JSON.parse(op.inputSchemaJson),
            });
            bytes += size;
          }
        }
        return { output: [{ type: 'text', text: JSON.stringify({ items, more }) }] };
      },
    }),
    defineTool({
      name: 'invoke_nimi_integration',
      description: 'Invoke a granted read or write operation on a connected Nimi Integration discovered via find_nimi_integrations. Requires user approval. If the returned status is accepted or unconfirmed, NEVER blindly resubmit; check its callId with read_nimi_receipt.',
      parameters: obj({ targetRef: str(), operation: str(), input: map(unknown()) }),
      replay: 'unsafe',
      async execute({ targetRef, operation, input }, _api, context) {
        const signal = context.abortSignal ? AbortSignal.any([context.abortSignal, account]) : account;
        signal.throwIfAborted();
        const target = (await client.listCatalog()).find(t => t.targetRef === targetRef && t.available && !isOwnHarnessSessionProvider(t.integrationId));
        const op = target?.operations.find(item => item.name === operation && (item.effect === 'read' || item.effect === 'write'));
        if (!target?.permittedOperations.includes(operation) || !op) {
          throw new Error('This integration operation is unavailable or is not granted to Harness in Home.');
        }
        signal.throwIfAborted();
        return dispatchAndObserve(client, targetRef, operation, input, signal);
      },
    }),
    defineTool({
      name: 'read_nimi_receipt', description: 'Read the result of a previously accepted Nimi Integration call by call ID. This never submits the operation again.',
      parameters: obj({ callId: str() }), replay: 'safe',
      async execute({ callId }, _api, context) {
        const signal = context.abortSignal ? AbortSignal.any([context.abortSignal, account]) : account;
        signal.throwIfAborted();
        const call = await client.getCall({ callId });
        signal.throwIfAborted();
        return receipt(call);
      },
    }),
  ] });
}
