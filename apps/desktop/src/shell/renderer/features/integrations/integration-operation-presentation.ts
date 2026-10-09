import type { NimiIntegrationOperation } from '@nimiplatform/sdk/app';

// Display copy only. Runtime descriptors and exact operation IDs still own
// admission; an App-provided operation always keeps its source description.
export function integrationOperationPresentation(kind:string, operation:NimiIntegrationOperation, translate:(key:string)=>string) {
  const action=operation.name.startsWith(`${kind}.`)?operation.name.slice(kind.length+1):'';
  const key=({'messages.send':'send','messages.reply':'reply','messages.update':'update','updates.read':'receive','media.fetch':'media'} as Record<string,string>)[action];
  if(!['weixin','feishu','qq-official','onebot-v11'].includes(kind)||!key||(key==='update'&&kind!=='feishu'))return {name:operation.name,summary:operation.description};
  const summary=key==='send'&&(kind==='weixin'||kind==='qq-official')?`${key}_${kind==='weixin'?'weixin':'qq'}`:key;
  return {name:translate(`Integrations.operationNames.${key}`),summary:translate(`Integrations.operationSummaries.${summary}`)};
}
