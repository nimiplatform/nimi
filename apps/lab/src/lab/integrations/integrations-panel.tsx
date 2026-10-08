import { useEffect, useRef, useState } from 'react';
import { Button, InlineAlert, Surface } from '@nimiplatform/kit/ui';
import { openDesktopIntent } from '@nimiplatform/kit/shell/renderer/bridge';
import type { NimiIntegrationCall, NimiIntegrationTarget } from '@nimiplatform/sdk/app';
import { useLabRendererHost } from '../../renderer/context.js';
import { useTranslation } from '../../shell/i18n/index.js';
import { exportLabIntegrationHistory, integrationHistoryRecord, observeIntegrationHistory, savedIntegrationHistoryRecord, type LabIntegrationHistoryRecord } from './integration-history.js';
import { runLabIntegrationCall } from './integration-run.js';
import { NativeMessagePanel } from './native-message-panel.js';
import { nativeEventKey, nativeReadPage, nativeReceipt, type NativeEvent } from './native-message-model.js';
import { IntegrationAssetPreview } from './integration-asset-preview.js';
import { subscribeLabLocalAppSessionLoss } from '../../shell/auth/session-loss.js';
import type { StudioRunHistoryRecord } from '../../ai-studio-core/history.js';

const field = 'w-full rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-3 text-sm';
type Waiting = { controller: AbortController };
type ReceivedBatch = { target:NimiIntegrationTarget; input:string; call:NimiIntegrationCall };

// @nimi-authority: rule.nimi.sdks.feature-clients.integrations
// This App consumes only the public protected carrier. Home owns connections,
// credentials and grants; Lab owns its finite waiting and saved business facts.
export function LabIntegrationsPanel({ recordAI }: { recordAI: (record: StudioRunHistoryRecord) => Promise<void> }) {
  const host = useLabRendererHost(); const client = host.sdk.localAppClient.integration; const { t } = useTranslation();
  const [targets,setTargets] = useState<readonly NimiIntegrationTarget[]>([]);
  const [targetRef,setTargetRef] = useState(''); const [operation,setOperation] = useState(''); const [input,setInput] = useState('{}');
  const [history,setHistory] = useState<readonly LabIntegrationHistoryRecord[]>([]); const [call,setCall] = useState<NimiIntegrationCall | null>(null);
  const [busy,setBusy] = useState(false); const [error,setError] = useState(''); const [notice,setNotice] = useState('');
  const [refreshError,setRefreshError] = useState(''); const [scopeNotice,setScopeNotice] = useState(false);
  const refreshVersion = useRef(0);
  const [assetBusy,setAssetBusy] = useState(false);
  const locked=busy||assetBusy;
  const [callInput,setCallInput] = useState('');
  const [savedRecordId,setSavedRecordId] = useState('');
	const [events,setEvents] = useState<readonly NativeEvent[]>([]);
	const [saveReceived,setSaveReceived] = useState(false);
  const savedRecord = savedIntegrationHistoryRecord(history,savedRecordId);
  const active = useRef(true); const waiting = useRef<Waiting | null>(null);
  // View generation is only a publication guard, never platform admission.
  const currentHost=useRef(host); const scopeVersion=useRef(0);
  if(currentHost.current!==host){scopeVersion.current++;currentHost.current=host;}
  const version=scopeVersion.current;
  const sameView=()=>currentHost.current===host&&scopeVersion.current===version;
  const receivedBatches = useRef(new Map<string,ReceivedBatch>());
  const target = targets.find(item=>item.targetRef===targetRef); const descriptor = target?.operations.find(item=>item.name===operation);
  const receipt = call?nativeReceipt(call.operation,call.resultJson):undefined;
  const errorText = (cause: unknown) => cause instanceof Error ? t(`Integrations.errors.${cause.message}`,{defaultValue:cause.message}) : t('Integrations.unavailable');
  const report = (cause: unknown) => { if(active.current&&sameView()) setError(errorText(cause)); };
  const refresh = async () => {
    const request = ++refreshVersion.current;
    const current = () => active.current&&sameView()&&refreshVersion.current===request;
    try {
      const [next,saved] = await Promise.all([client.listConnections(),host.app.projection.integrationHistory()]);
      if(current()){setTargets(next);setHistory(saved);setRefreshError('');setScopeNotice(false);}
    } catch(cause) { if(current())setRefreshError(errorText(cause)); }
  };
  useEffect(()=>{
    active.current=true;receivedBatches.current.clear();setEvents([]);setCall(null);void refresh();
    const unsubscribe=subscribeLabLocalAppSessionLoss(()=>{
      if(!active.current||currentHost.current!==host)return;
      scopeVersion.current++;waiting.current?.controller.abort();waiting.current=null;setBusy(false);setAssetBusy(false);receivedBatches.current.clear();
      setEvents([]);setCall(null);setCallInput('');setTargets([]);setTargetRef('');setOperation('');setInput('{}');setHistory([]);setSavedRecordId('');setError('');setNotice('');setRefreshError('');setScopeNotice(true);
    });
    return ()=>{active.current=false;waiting.current?.controller.abort();unsubscribe();};
  },[client,host]);
  const save = async (source:NimiIntegrationTarget,inputJson:string,next:NimiIntegrationCall,saveBody=false) => {
    if(!sameView())return;
    const saved=await host.app.commands.appendIntegrationHistory(integrationHistoryRecord(source,inputJson,next,saveBody)); if(active.current&&sameView())setHistory(saved);
  };
  const invoke = async (requestedOperation = operation, requestedInput = input, receiving = false) => {
    if(!target || !target.operations.some(item=>item.name===requestedOperation) || locked || waiting.current)return;
    let normalized:string;try{normalized=JSON.stringify(JSON.parse(requestedInput));}catch{setError(t('Integrations.invalidJson'));return;}
    const task:Waiting={controller:new AbortController()};waiting.current=task;setBusy(true);setError('');setNotice('');
    try{
      const started = Date.now(); let reads = 0;
      do {
        let terminal:NimiIntegrationCall|null=null;
        const publish=async(next:NimiIntegrationCall)=>{if(task.controller.signal.aborted || !active.current)return;setCall(next);setCallInput(normalized);await save(target,normalized,next,requestedOperation.endsWith('.updates.read')&&saveReceived);};
        await runLabIntegrationCall({client,targetRef:target.targetRef,operation:requestedOperation,inputJson:normalized,signal:task.controller.signal,accepted:publish,completed:async next=>{
          terminal=next;await publish(next);
          if(task.controller.signal.aborted||!active.current)return;
          if(requestedOperation.endsWith('.updates.read')&&next.status==='completed'){
            const page=nativeReadPage(next.resultJson);
            for(const event of page.events)receivedBatches.current.set(nativeEventKey(target.kind,event),{target,input:normalized,call:next});
            while(receivedBatches.current.size>100)receivedBatches.current.delete(receivedBatches.current.keys().next().value!);
            setEvents(current=>[...new Map([...current,...page.events].map(event=>[nativeEventKey(target.kind,event),event])).values()].slice(-100));
            if(page.coverageGap)setNotice(t('Integrations.coverageGap',{gap:page.coverageGap}));
            normalized=JSON.stringify({...JSON.parse(normalized),cursor:page.cursor});
          }
        }});
        if(terminal&&(terminal as NimiIntegrationCall).status!=='completed')throw new Error((terminal as NimiIntegrationCall).errorCode||t('Integrations.unavailable'));
        reads++;
      } while(receiving&&!task.controller.signal.aborted&&active.current&&reads<100&&Date.now()-started<15*60*1000);
      if(receiving&&!task.controller.signal.aborted&&active.current)setNotice(t('Integrations.receiveEnded'));
    }catch(cause){
      report(cause);
    }finally{const ownsSlot=waiting.current===task;if(ownsSlot)waiting.current=null;if(active.current&&sameView()&&ownsSlot)setBusy(false);}
  };
  const stop = async()=>{
    const task=waiting.current;if(!task)return;task.controller.abort();setNotice(t('Integrations.waitStopped'));
  };
  const observe = async(record:LabIntegrationHistoryRecord)=>{
    setError('');try{
      const next=await client.getCall({callId:record.callId});if(!active.current||!sameView())return;setCall(next);setCallInput(record.inputJson);
      const updated=observeIntegrationHistory(record,next);
      const saved=await host.app.commands.appendIntegrationHistory(updated);if(active.current&&sameView())setHistory(saved);
    }catch(cause){report(cause);}
  };
  const savePrivateBody = async()=>{
    if(!call || locked)return;
    const record=history.find(item=>item.callId===call.callId);if(!record)return;
    try{
      const saved=await host.app.commands.appendIntegrationHistory(observeIntegrationHistory({...record,inputJson:callInput},call,true));
      if(active.current&&sameView()){setHistory(saved);setNotice(t('Integrations.bodySaved'));}
    }catch(cause){report(cause);}
  };
  const saveReceivedBatch = async(eventId:string)=>{
    if(locked)return;
    const batch=receivedBatches.current.get(eventId);if(!batch)return;
    await save(batch.target,batch.input,batch.call,true);
    if(active.current&&sameView())setNotice(t('Integrations.bodySaved'));
  };
  const remove = async(record:LabIntegrationHistoryRecord)=>{
    setError('');try{
      for(const path of record.assetPaths){if(!sameView())return;await host.sdk.localAppClient.storage.assets.remove(path);}
      if(!sameView())return;
      const saved=await host.app.commands.removeIntegrationHistory(record.id);if(active.current&&sameView())setHistory(saved);
    }catch(cause){report(cause);}
  };
  return <div className="h-full overflow-y-auto p-5" data-testid="lab-integrations-panel"><div className="mx-auto flex max-w-5xl flex-col gap-5">
    <header><h1 className="text-2xl font-semibold">{t('Integrations.title')}</h1><p className="mt-2 text-sm text-[var(--nimi-text-secondary)]">{t('Integrations.description')}</p></header>
    {scopeNotice?<InlineAlert tone="warning">{t('Integrations.sessionEnded')}</InlineAlert>:null}
    {refreshError?<InlineAlert tone="warning">{refreshError}</InlineAlert>:null}
    {error?<InlineAlert tone="warning">{error}</InlineAlert>:null}{notice?<InlineAlert tone="info">{notice}</InlineAlert>:null}
    <div className="flex flex-wrap gap-3"><Button tone="secondary" disabled={locked} onClick={()=>void refresh()}>{t('Integrations.refresh')}</Button><Button tone="secondary" onClick={()=>{setError('');setNotice('');void openDesktopIntent({intent:{kind:'open-integrations'}}).then(result=>{if(result.status==='rejected')throw new Error(t('Integrations.openRejected',{reason:result.reasonCode}));setNotice(t('Integrations.returnRefresh'));}).catch(report);}}>{t('Integrations.manageInHome')}</Button></div>
    {!targets.length?<InlineAlert tone="info">{t('Integrations.empty')}</InlineAlert>:null}
    <Surface tone="panel" className="flex flex-col gap-4">
      <label className="text-sm">{t('Integrations.target')}<select className={field} disabled={locked} value={targetRef} onChange={event=>{setTargetRef(event.target.value);setOperation('');setCall(null);setEvents([]);receivedBatches.current.clear();}}><option value="">{t('Integrations.selectTarget')}</option>{targets.map(item=><option key={item.targetRef} value={item.targetRef}>{item.displayName}{item.accountLabel&&!item.displayName.includes(item.accountLabel)?` · ${item.accountLabel}`:''}</option>)}</select></label>
      {target&&!target.available?<InlineAlert tone="warning">{t('Integrations.connectionUnavailable')}</InlineAlert>:null}
      {target&&!target.permittedOperations.length?<InlineAlert tone="info">{t('Integrations.permissionRequired')}</InlineAlert>:null}
      {target&&['weixin','feishu','qq-official','onebot-v11'].includes(target.kind)?<NativeMessagePanel key={target.targetRef} target={target} busy={locked} events={events} saveReceived={saveReceived} setSaveReceived={setSaveReceived} setAssetBusy={setAssetBusy} saveEvent={saveReceivedBatch} invoke={invoke} recordAI={recordAI} recordReplyCall={(inputJson,next)=>save(target,inputJson,next)} report={report}/>:null}
      <details className="text-sm"><summary>{t('Integrations.advancedOperations')}</summary>
      <label className="mt-3 block text-sm">{t('Integrations.operation')}<select className={field} disabled={locked} value={operation} onChange={event=>{setOperation(event.target.value);setInput('{}');}}><option value="">{t('Integrations.selectOperation')}</option>{target?.operations.map(item=><option key={item.name} value={item.name} disabled={!target.permittedOperations.includes(item.name)}>{item.name} · {t(`Integrations.effects.${item.effect}`)}</option>)}</select></label>
      {descriptor?<><p className="text-sm">{descriptor.description}</p><details className="text-sm"><summary>{t('Integrations.inputSchema')}</summary><pre className="mt-2 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(JSON.parse(descriptor.inputSchemaJson),null,2)}</pre></details></>:null}
      <label className="text-sm">{t('Integrations.input')}<textarea className={`${field} min-h-40 font-mono`} value={input} maxLength={256*1024} disabled={locked} onChange={event=>setInput(event.target.value)}/></label>
      <p className="text-xs text-[var(--nimi-text-secondary)]">{t('Integrations.noResend')}</p>
      <p className="text-xs text-[var(--nimi-text-secondary)]">{t('Integrations.bodyPrivacy')}</p>
      <Button className="mt-3" disabled={busy || !target?.available || !descriptor || !target.permittedOperations.includes(operation)} onClick={()=>void invoke()}>{t('Integrations.invoke')}</Button>
      </details>
      <Button tone="secondary" disabled={!busy} onClick={()=>void stop()}>{t('Integrations.stop')}</Button>
      {call?<div data-testid="integration-call"><p className="text-sm">{t(`Integrations.states.${call.status}`)} · {call.callId}</p>{call.errorCode?<p className="text-sm">{t(`Integrations.errors.${call.errorCode}`,{defaultValue:call.errorCode})} · {call.errorCode}</p>:null}{receipt?<div className="mt-2 text-sm"><p>{t(`Integrations.confirmations.${receipt.confirmation}`)}</p><p>{receipt.messageId?`${t('Integrations.nativeMessageId')}: ${receipt.messageId}`:t('Integrations.noNativeMessageId')}</p><p className="mt-1 text-xs">{t('Integrations.receiptBoundary')}</p></div>:null}{call.status==='unconfirmed'?<InlineAlert tone="warning">{t('Integrations.noResend')}</InlineAlert>:null}{call.resultJson?<pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(JSON.parse(call.resultJson),null,2)}</pre>:null}{history.find(record=>record.callId===call.callId)?.assetPaths.map(path=><IntegrationAssetPreview key={path} relativePath={path} disabled={locked} report={report}/>)}<Button className="mt-3" size="sm" tone="secondary" disabled={locked} onClick={()=>void savePrivateBody()}>{t('Integrations.saveBody')}</Button></div>:null}
    </Surface>
    <Surface tone="panel"><div className="flex items-center justify-between gap-3"><h2 className="font-semibold">{t('Integrations.history')}</h2><Button tone="secondary" disabled={!history.length} onClick={()=>void host.app.commands.exportText({filename:'nimi-lab-integrations.json',body:exportLabIntegrationHistory(history)}).catch(report)}>{t('Integrations.export')}</Button></div>
      {savedRecord?<div className="mt-4 rounded-xl border border-[var(--nimi-border-subtle)] p-4" data-testid="integration-saved-record"><h3 className="font-semibold">{t('Integrations.savedRecord')}</h3><p className="mt-2 text-xs">{t('Integrations.savedSnapshot')}</p><p className="mt-2 break-all text-sm">{savedRecord.targetDisplayName} · {savedRecord.operation} · {t(`Integrations.states.${savedRecord.status}`)}</p><p className="mt-1 break-all text-xs">{savedRecord.callId} · {savedRecord.createdAt}</p>{savedRecord.errorCode?<p className="mt-2 text-sm">{savedRecord.errorCode}</p>:null}{savedRecord.inputJson?<><h4 className="mt-3 text-sm">{t('Integrations.savedInput')}</h4><pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(JSON.parse(savedRecord.inputJson),null,2)}</pre></>:null}{savedRecord.resultJson?<><h4 className="mt-3 text-sm">{t('Integrations.savedResult')}</h4><pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(JSON.parse(savedRecord.resultJson),null,2)}</pre></>:null}{!savedRecord.inputJson&&!savedRecord.resultJson?<p className="mt-3 text-sm">{t('Integrations.noSavedBody')}</p>:null}{savedRecord.assetPaths.length?<div>{savedRecord.assetPaths.map(path=><IntegrationAssetPreview key={path} relativePath={path} disabled={locked} report={report}/>)}</div>:null}<Button className="mt-3" size="sm" tone="secondary" onClick={()=>setSavedRecordId('')}>{t('Integrations.closeSaved')}</Button></div>:null}
      {!history.length?<p className="mt-3 text-sm">{t('Integrations.noHistory')}</p>:null}
      {history.map(record=><div key={record.id} className="mt-4 border-t border-[var(--nimi-border-subtle)] pt-3 text-sm"><p>{record.targetDisplayName} · {record.operation} · {t(`Integrations.states.${record.status}`)}</p><p className="mt-1 break-all text-xs">{record.callId}</p><div className="mt-2 flex gap-2"><Button size="sm" tone="secondary" onClick={()=>setSavedRecordId(record.id)}>{t('Integrations.viewSaved')}</Button><Button size="sm" tone="secondary" disabled={locked} onClick={()=>void observe(record)}>{t('Integrations.observe')}</Button><Button size="sm" tone="danger" disabled={locked} onClick={()=>void remove(record)}>{t('Integrations.remove')}</Button></div></div>)}
    </Surface>
  </div></div>;
}
