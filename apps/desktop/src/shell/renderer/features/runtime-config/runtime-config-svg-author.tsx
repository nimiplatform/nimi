import { useState } from 'react';
import { Button, SelectField, Surface } from '@nimiplatform/kit/ui';
import type { TFunction } from 'i18next';
import type { ConnectorSVGAuthorUpdate } from '@nimiplatform/sdk/runtime/wire-types';
import type { ApiConnector } from './runtime-config-state-types.js';
import type { ConnectorModelInfo } from './runtime-config-connector-sdk-service.js';
import { useRuntimeConfigConnectorSdk } from './runtime-config-connector-sdk-context.js';

// @nimi-authority: rule.nimi.runtime.ai-provider.openai-svg-author
export function CloudSVGAuthor({connector,disabled,onSaved,t}:{connector:ApiConnector;disabled:boolean;onSaved:(value:ApiConnector)=>void;t:TFunction}) {
  const sdk=useRuntimeConfigConnectorSdk();
  const [editing,setEditing]=useState(false);
  const [busy,setBusy]=useState(false);
  const [models,setModels]=useState<ConnectorModelInfo[]>([]);
  const [selected,setSelected]=useState('');
  const [error,setError]=useState('');
  async function begin() {
    setBusy(true);setError('');
    try {
      const candidates=(await sdk.sdkListConnectorModelDescriptors(connector.id,true)).filter(model=>model.capabilities.includes('text.generate'));
      setModels(candidates);
      setSelected(candidates.find(model=>model.providerModelId===connector.svgAuthor?.providerModelId && model.remoteModelCatalogId===connector.svgAuthor.remoteModelCatalogId)?.remoteModelCatalogId??'');
      setEditing(true);
    }catch{setError(t('runtimeConfig.svgAuthor.loadFailed'));}finally{setBusy(false);}
  }
  async function save(change:ConnectorSVGAuthorUpdate['change']) {
    setBusy(true);setError('');
    try {
      const saved=await sdk.sdkUpdateConnector({connectorId:connector.id,svgAuthor:{change}});
      if(!saved)throw new Error();
      onSaved(saved);setEditing(false);
    }catch{setError(t('runtimeConfig.svgAuthor.saveFailed'));}finally{setBusy(false);}
  }
  const chosen=models.find(model=>model.remoteModelCatalogId===selected);
  return <Surface tone="panel" className="space-y-3 p-4" data-testid="cloud-svg-author">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-sm font-semibold">{t('runtimeConfig.svgAuthor.title')}</h3><p className="mt-1 text-sm text-[var(--nimi-text-secondary)]">{connector.svgAuthor?.providerModelId??t('runtimeConfig.svgAuthor.unconfigured')}</p></div>{!editing?<Button size="sm" tone="secondary" disabled={disabled||busy} onClick={()=>void begin()}>{t('runtimeConfig.svgAuthor.configure')}</Button>:null}</div>
    <p className="text-xs text-[var(--nimi-text-muted)]">{t('runtimeConfig.svgAuthor.description')}</p>
    {editing?<div className="space-y-3">
      <SelectField aria-label={t('runtimeConfig.svgAuthor.model')} value={selected||'unselected'} disabled={disabled||busy} options={[{value:'unselected',label:t('runtimeConfig.svgAuthor.choose')},...models.map(model=>({value:model.remoteModelCatalogId,label:model.modelLabel||model.providerModelId}))]} onValueChange={value=>setSelected(value==='unselected'?'':value)} />
      <p className="text-xs text-[var(--nimi-text-muted)]">{t('runtimeConfig.svgAuthor.availability')}</p>
      <div className="flex flex-wrap gap-2"><Button size="sm" disabled={disabled||busy||!chosen} onClick={()=>{if(chosen)void save({oneofKind:'author',author:{providerModelId:chosen.providerModelId,remoteModelCatalogId:chosen.remoteModelCatalogId}});}}>{t('runtimeConfig.svgAuthor.save')}</Button><Button size="sm" tone="ghost" disabled={busy} onClick={()=>setEditing(false)}>{t('runtimeConfig.svgAuthor.cancel')}</Button>{connector.svgAuthor?<Button size="sm" tone="ghost" disabled={disabled||busy} onClick={()=>void save({oneofKind:'remove',remove:true})}>{t('runtimeConfig.svgAuthor.remove')}</Button>:null}</div>
    </div>:null}
    {error?<p role="alert" className="text-xs text-[var(--nimi-status-danger)]">{error}</p>:null}
  </Surface>;
}
