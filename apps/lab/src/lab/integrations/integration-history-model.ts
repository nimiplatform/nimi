import type { NimiIntegrationCall, NimiIntegrationTarget } from '@nimiplatform/sdk/app';
export type LabIntegrationHistoryRecord = Readonly<{
  kind: 'integration'; id: string; adapter: string; targetRef: string; targetDisplayName: string;
  operation: string; callId: string; status: NimiIntegrationCall['status']; createdAt: string;
  inputJson: string; resultJson: string; errorCode: string; assetPaths: readonly string[];
}>;
const KEYS = ['kind','id','adapter','targetRef','targetDisplayName','operation','callId','status','createdAt','inputJson','resultJson','errorCode','assetPaths'];
function validPath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 1024 && !value.startsWith('/') && !value.includes('\\') && !value.includes(':') && !value.includes('\0') && !value.split('/').some(part => part === '..' || part === '.' || part === '');
}

// @nimi-authority: rule.nimi.sdks.feature-clients.integrations
export function parseLabIntegrationHistory(value: unknown): readonly LabIntegrationHistoryRecord[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('Integration history requires an array.');
  const ids = new Set<string>();
  return value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).length !== KEYS.length || KEYS.some(key => !Object.hasOwn(item,key)) || item.kind !== 'integration' || !['accepted','completed','failed','canceled','unconfirmed'].includes(item.status)) throw new Error('Invalid Integration history record.');
    for (const key of KEYS.filter(key => key !== 'assetPaths')) {
      if (typeof item[key] !== 'string' || item[key].includes('\0') || new TextEncoder().encode(item[key]).byteLength > (key === 'resultJson' ? 1024*1024 : key === 'inputJson' ? 256*1024 : 1024)) throw new Error('Invalid Integration history text.');
    }
    if (!item.id || ids.has(item.id) || !item.callId || !item.targetRef || !item.operation || !item.adapter || !Number.isFinite(Date.parse(item.createdAt)) || !Array.isArray(item.assetPaths) || item.assetPaths.length > 32 || !item.assetPaths.every(validPath)) throw new Error('Invalid Integration history attribution.');
    for (const field of ['inputJson','resultJson']) if (item[field]) JSON.parse(item[field]);
    ids.add(item.id);
    return Object.freeze({ ...item, assetPaths: Object.freeze([...item.assetPaths]) }) as LabIntegrationHistoryRecord;
  });
}

export function integrationHistoryRecord(target: NimiIntegrationTarget, inputJson: string, call: NimiIntegrationCall, savePrivateBody = false): LabIntegrationHistoryRecord {
  const paths: string[] = [];
  if (['completed','unconfirmed'].includes(call.status) && ['weixin','feishu','qq-official','onebot-v11'].includes(target.kind) && call.operation === `${target.kind}.media.fetch` && call.resultJson) {
    const result = JSON.parse(call.resultJson) as { asset?: { relativePath?: unknown } };
    if (validPath(result.asset?.relativePath)) paths.push(result.asset.relativePath);
  }
  return parseLabIntegrationHistory([{ kind:'integration',id:call.callId,adapter:target.kind,targetRef:call.targetRef,targetDisplayName:call.targetDisplayName || target.displayName,operation:call.operation,callId:call.callId,status:call.status,createdAt:call.createdAt || new Date().toISOString(),inputJson:savePrivateBody?inputJson:'',resultJson:savePrivateBody?call.resultJson:'',errorCode:call.errorCode,assetPaths:paths }])[0]!;
}

export function observeIntegrationHistory(record: LabIntegrationHistoryRecord, call: NimiIntegrationCall, savePrivateBody = false): LabIntegrationHistoryRecord {
  if (call.callId !== record.callId || call.targetRef !== record.targetRef || call.operation !== record.operation) throw new Error('Integration call attribution changed.');
  const next = integrationHistoryRecord({ kind: record.adapter, displayName: record.targetDisplayName } as NimiIntegrationTarget, record.inputJson, {
    ...call, createdAt: record.createdAt, resultJson: call.resultJson || record.resultJson,
  },savePrivateBody);
  return parseLabIntegrationHistory([{ ...next,inputJson:savePrivateBody?next.inputJson:record.inputJson,resultJson:savePrivateBody?next.resultJson:record.resultJson,assetPaths: next.assetPaths.length ? next.assetPaths : record.assetPaths }])[0]!;
}

export function exportLabIntegrationHistory(records: readonly LabIntegrationHistoryRecord[]): string {
  return JSON.stringify({ format:'nimi-lab-integration-history-v1',records:parseLabIntegrationHistory(records) },null,2);
}

// This is an App-owned saved snapshot, independent of current Runtime scope,
// connection availability or private result retention. It never queries a call.
export function savedIntegrationHistoryRecord(records: readonly LabIntegrationHistoryRecord[], id: string): LabIntegrationHistoryRecord | undefined {
  return records.find(record => record.id === id);
}
