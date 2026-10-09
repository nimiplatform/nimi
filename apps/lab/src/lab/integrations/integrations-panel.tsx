import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, InlineAlert, Surface } from '@nimiplatform/kit/ui';
import { openDesktopIntent } from '@nimiplatform/kit/shell/renderer/bridge';
import type { NimiIntegrationCall, NimiIntegrationTarget } from '@nimiplatform/sdk/app';
import { useLabRendererHost } from '../../renderer/context.js';
import { useTranslation } from '../../shell/i18n/index.js';
import { exportLabIntegrationHistory, integrationHistoryRecord, observeIntegrationHistory, type LabIntegrationHistoryRecord } from './integration-history.js';
import { runLabIntegrationCall } from './integration-run.js';
import { integrationHistoryWork } from './integration-history-work.js';
import { NativeMessagePanel } from './native-message-panel.js';
import { nativeEventKey, nativeReadPage, nativeReceipt, type NativeEvent } from './native-message-model.js';
import { IntegrationAssetsPanel } from './integration-assets-panel.js';
import { HistoricalIntegrationAssets, IntegrationSavedRecord } from './integration-saved-record.js';
import { subscribeLabLocalAppSessionLoss } from '../../shell/auth/session-loss.js';
import type { StudioRunHistoryRecord } from '../../ai-studio-core/history.js';

const field = 'w-full rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-3 text-sm';
type Waiting = { controller: AbortController };
type ReceivedBatch = { target:NimiIntegrationTarget; input:string; call:NimiIntegrationCall };

// @nimi-authority: rule.nimi.sdks.feature-clients.integrations
// This App consumes only the public protected carrier. Home owns connections,
// credentials and grants; Lab owns its finite waiting and saved business facts.
export function LabIntegrationsPanel({ recordAI }: { recordAI: (record: StudioRunHistoryRecord) => Promise<void> }) {
  const host = useLabRendererHost(); const client = host.sdk.localAppClient.integration; const { t, i18n } = useTranslation();
  const [targets,setTargets] = useState<readonly NimiIntegrationTarget[]>([]);
  const [targetRef,setTargetRef] = useState(''); const [operation,setOperation] = useState(''); const [input,setInput] = useState('{}');
  const [history,setHistory] = useState<readonly LabIntegrationHistoryRecord[]>([]); const [call,setCall] = useState<NimiIntegrationCall | null>(null);
  const [busy,setBusy] = useState(false); const [error,setError] = useState(''); const [notice,setNotice] = useState('');
  const [refreshError,setRefreshError] = useState(''); const [scopeNotice,setScopeNotice] = useState(false);
  const [historyError,setHistoryError] = useState('');
  const [receivingBusy,setReceivingBusy] = useState(false); const [receiveCall,setReceiveCall] = useState<NimiIntegrationCall|null>(null);
  const [receiveStopping,setReceiveStopping] = useState(false);
  const [receiveNotice,setReceiveNotice] = useState(''); const [receiveError,setReceiveError] = useState('');
  const refreshVersion = useRef(0);
  const [assetBusy,updateAssetBusy] = useState(false); const assetSlot = useRef(false);
  const setAssetBusy = useCallback((value:boolean)=>{assetSlot.current=value;updateAssetBusy(value);},[]);
  const locked=busy||assetBusy;
  const [callInput,setCallInput] = useState('');
  const [savedRecordId,setSavedRecordId] = useState('');
  const savedDetail = useRef<HTMLDivElement>(null); const savedTrigger = useRef<HTMLButtonElement | null>(null);
  const [exported,setExported] = useState<{path:string;revealed:boolean} | null>(null); const [exporting,setExporting] = useState(false);
  const [exportError,setExportError] = useState('');
  const exportBusy = useRef(false); const displayVersion = useRef(0);
	const [events,setEvents] = useState<readonly NativeEvent[]>([]);
	const [receivedCount,setReceivedCount] = useState(0);
	const [saveReceived,setSaveReceived] = useState(false);
  const active = useRef(true); const waiting = useRef<Waiting | null>(null);
  const receiving = useRef<Waiting|null>(null); const viewVersion = useRef(0);
  const pending = useRef(new Set<Promise<void>>());
  const historyWork=integrationHistoryWork(host);const [historyBusy,setHistoryBusy] = useState<readonly string[]>(historyWork.ids());
  // View generation is only a publication guard, never platform admission.
  const currentHost=useRef(host); const scopeVersion=useRef(0);
  if(currentHost.current!==host){scopeVersion.current++;currentHost.current=host;}
  const version=scopeVersion.current;
  const sameView=()=>currentHost.current===host&&scopeVersion.current===version;
  const holdHistory=(id:string)=>historyWork.hold(id);
  useEffect(()=>{const update=()=>{if(active.current&&sameView())setHistoryBusy(historyWork.ids());};update();return historyWork.subscribe(update);},[host,historyWork]);
  const receivedBatches = useRef(new Map<string,ReceivedBatch>());
  const target = targets.find(item=>item.targetRef===targetRef); const descriptor = target?.operations.find(item=>item.name===operation);
  const receipt = call?nativeReceipt(call.operation,call.resultJson):undefined;
  useEffect(()=>{if(savedRecordId&&savedDetail.current){savedDetail.current.focus({preventScroll:true});savedDetail.current.scrollIntoView({block:'nearest'});}},[savedRecordId]);
  const closeSaved = () => { setSavedRecordId(''); if(savedTrigger.current?.isConnected){savedTrigger.current.focus({preventScroll:true});savedTrigger.current.scrollIntoView({block:'nearest'});} };
  const errorText = (cause: unknown) => cause instanceof Error ? t(`Integrations.errors.${cause.message}`,{defaultValue:cause.message}) : t('Integrations.unavailable');
  const report = (cause: unknown) => { if(active.current&&sameView()) setError(errorText(cause)); };
  const refresh = async () => {
    const request = ++refreshVersion.current;
    const current = () => active.current&&sameView()&&refreshVersion.current===request;
    await Promise.all([
      client.listConnections().then(next=>{if(current()){setTargets(next);setRefreshError('');setScopeNotice(false);}},cause=>{if(current())setRefreshError(errorText(cause));}),
      host.app.projection.integrationHistory().then(saved=>{if(current()){setHistory(saved);setHistoryError('');}},cause=>{if(current())setHistoryError(errorText(cause));}),
    ]);
  };
  useEffect(()=>{
    active.current=true;displayVersion.current++;exportBusy.current=false;setExported(null);setExporting(false);setExportError('');receivedBatches.current.clear();setHistoryBusy(historyWork.ids());setEvents([]);setReceivedCount(0);setCall(null);setReceiveCall(null);setHistory([]);setTargets([]);setTargetRef('');setOperation('');setInput('{}');setSavedRecordId('');setCallInput('');setBusy(false);setReceivingBusy(false);setAssetBusy(false);setError('');setNotice('');setReceiveError('');setReceiveNotice('');setRefreshError('');setHistoryError('');void refresh();
    const unsubscribe=subscribeLabLocalAppSessionLoss(()=>{
      if(currentHost.current!==host)return;
      scopeVersion.current++;displayVersion.current++;exportBusy.current=false;setExported(null);setExporting(false);setExportError('');waiting.current?.controller.abort();receiving.current?.controller.abort();waiting.current=null;receiving.current=null;
      if(!active.current)return;
      setBusy(false);setReceivingBusy(false);setAssetBusy(false);receivedBatches.current.clear();
      historyWork.invalidate();setHistoryBusy([]);
      setEvents([]);setReceivedCount(0);setCall(null);setReceiveCall(null);setReceiveNotice('');setReceiveError('');setCallInput('');setTargets([]);setTargetRef('');setOperation('');setInput('{}');setHistory([]);setSavedRecordId('');setError('');setNotice('');setRefreshError('');setHistoryError('');setScopeNotice(true);
    });
    return ()=>{active.current=false;viewVersion.current++;waiting.current?.controller.abort();receiving.current?.controller.abort();void Promise.allSettled([...pending.current]).finally(unsubscribe);};
  },[client,host]);
  const save = async (source:NimiIntegrationTarget,inputJson:string,next:NimiIntegrationCall,saveBody=false) => {
    if(!sameView())return;
    const saved=await host.app.commands.appendIntegrationHistory(integrationHistoryRecord(source,inputJson,next,saveBody)); if(active.current&&sameView())setHistory(saved);
  };
  const invoke = async (requestedOperation = operation, requestedInput = input, receiveLoop = false) => {
    const slot=receiveLoop?receiving:waiting;
    if(!target || !target.operations.some(item=>item.name===requestedOperation) || slot.current || (!receiveLoop&&assetSlot.current))return;
    let normalized:string;try{normalized=JSON.stringify(JSON.parse(requestedInput));}catch{setError(t('Integrations.invalidJson'));return;}
    const task:Waiting={controller:new AbortController()};slot.current=task;
    const display=receiveLoop?displayVersion.current:++displayVersion.current;
    if(!receiveLoop){setCall(null);setCallInput('');}
    const view=viewVersion.current;const visible=()=>active.current&&sameView()&&viewVersion.current===view&&slot.current===task&&(receiveLoop||displayVersion.current===display);
    if(receiveLoop){setReceivingBusy(true);setReceiveStopping(false);setReceiveError('');setReceiveNotice('');}else{setBusy(true);setError('');setNotice('');}
    const work=(async()=>{try{
      const started = Date.now(); let reads = 0;
      do {
        let terminal:NimiIntegrationCall|null=null;
        let observedId='';
        let releaseObserved=()=>{};
        const observed=async(next:NimiIntegrationCall)=>{
          if(!sameView())return;
          if(!observedId){observedId=next.callId;releaseObserved=holdHistory(observedId);}
          // Preserve actual ID/outcome after stop, without publishing a late body.
          if(visible()){if(receiveLoop)setReceiveCall({...next,resultJson:''});else{setCall({...next,resultJson:''});setCallInput('');}}
          await save(target,normalized,next);
        };
        const publish=async(next:NimiIntegrationCall)=>{if(task.controller.signal.aborted || !visible())return;if(receiveLoop)setReceiveCall(next);else{setCall(next);setCallInput(normalized);}if(requestedOperation.endsWith('.updates.read')&&saveReceived)await save(target,normalized,next,true);};
        try{await runLabIntegrationCall({client,targetRef:target.targetRef,operation:requestedOperation,inputJson:normalized,signal:task.controller.signal,currentScope:sameView,observed,accepted:publish,completed:async next=>{
          terminal=next;await publish(next);
          if(task.controller.signal.aborted||!visible())return;
          if(requestedOperation.endsWith('.updates.read')&&next.status==='completed'){
            const page=nativeReadPage(next.resultJson);
            let added=0;for(const event of page.events){const key=nativeEventKey(target.kind,event);if(!receivedBatches.current.has(key))added++;receivedBatches.current.set(key,{target,input:normalized,call:next});}
            if(added)setReceivedCount(current=>current+added);
            while(receivedBatches.current.size>100)receivedBatches.current.delete(receivedBatches.current.keys().next().value!);
            setEvents(current=>[...new Map([...current,...page.events].map(event=>[nativeEventKey(target.kind,event),event])).values()].slice(-100));
            if(page.coverageGap)(receiveLoop?setReceiveNotice:setNotice)(t('Integrations.coverageGap',{gap:page.coverageGap}));
            normalized=JSON.stringify({...JSON.parse(normalized),cursor:page.cursor});
          }
        }});}finally{releaseObserved();}
        if(terminal&&(terminal as NimiIntegrationCall).status!=='completed')throw new Error((terminal as NimiIntegrationCall).errorCode||t('Integrations.unavailable'));
        reads++;
      } while(receiveLoop&&!task.controller.signal.aborted&&visible()&&reads<100&&Date.now()-started<15*60*1000);
      if(receiveLoop&&!task.controller.signal.aborted&&visible())setReceiveNotice(t('Integrations.receiveEnded'));
    }catch(cause){
      if(!task.controller.signal.aborted&&visible())(receiveLoop?setReceiveError:setError)(errorText(cause));
    }finally{const ownsSlot=slot.current===task;if(ownsSlot)slot.current=null;if(active.current&&sameView()&&viewVersion.current===view&&ownsSlot)(receiveLoop?setReceivingBusy:setBusy)(false);}})();
    pending.current.add(work);try{await work;}finally{pending.current.delete(work);}
  };
  const stop = async()=>{
    const task=waiting.current;if(!task)return;task.controller.abort();setNotice(t('Integrations.waitStopped'));
  };
  const stopReceiving=()=>{if(receiving.current){receiving.current.controller.abort();setReceiveStopping(true);setReceiveNotice(t('Integrations.waitStopped'));}};
  const changeTarget=(value:string)=>{viewVersion.current++;displayVersion.current++;waiting.current?.controller.abort();receiving.current?.controller.abort();waiting.current=null;receiving.current=null;setBusy(false);setReceivingBusy(false);setAssetBusy(false);setTargetRef(value);setOperation('');setCall(null);setReceiveCall(null);setReceiveNotice('');setReceiveError('');setEvents([]);setReceivedCount(0);receivedBatches.current.clear();};
  const observe = async(record:LabIntegrationHistoryRecord)=>{
    if(locked||historyWork.busy(record.id))return;const release=holdHistory(record.id);
    const display=++displayVersion.current;const view=viewVersion.current;
    const visible=()=>active.current&&sameView()&&viewVersion.current===view&&displayVersion.current===display;
    setError('');try{
      const next=await client.getCall({callId:record.callId});if(!active.current||!sameView())return;
      const updated=observeIntegrationHistory(record,next);
      if(visible()){setCall(next);setCallInput(record.inputJson);}
      const saved=await host.app.commands.appendIntegrationHistory(updated);if(active.current&&sameView())setHistory(saved);
    }catch(cause){if(visible())report(cause);}finally{release();}
  };
  const savePrivateBody = async()=>{
    if(!call || locked)return;
    const record=history.find(item=>item.callId===call.callId);if(!record)return;
    if(historyWork.busy(record.id))return;const release=holdHistory(record.id);
    try{
      const saved=await host.app.commands.appendIntegrationHistory(observeIntegrationHistory({...record,inputJson:callInput},call,true));
      if(active.current&&sameView()){setHistory(saved);setNotice(t('Integrations.bodySaved'));}
    }catch(cause){report(cause);}finally{release();}
  };
  const saveReceivedBatch = async(eventId:string)=>{
    if(locked)return;
    const batch=receivedBatches.current.get(eventId);if(!batch)return;
    if(historyWork.busy(batch.call.callId))return;const release=holdHistory(batch.call.callId);
    try{await save(batch.target,batch.input,batch.call,true);if(active.current&&sameView())setNotice(t('Integrations.bodySaved'));}finally{release();}
  };
  const remove = async(record:LabIntegrationHistoryRecord)=>{
    if(historyWork.busy(record.id))return;const release=holdHistory(record.id);
    setError('');try{
      if(!sameView())return;
      const saved=await host.app.commands.removeIntegrationHistory(record.id);if(active.current&&sameView())setHistory(saved);
    }catch(cause){report(cause);}finally{release();}
  };
  const exportHistory = async () => {
    if(exportBusy.current)return;exportBusy.current=true;setExporting(true);setExportError('');setExported(null);
    try {
      const result=await host.app.commands.exportText({filename:'nimi-lab-integrations.json',body:exportLabIntegrationHistory(history)});
      if(!active.current||!sameView())return;
      if(!result.ok){setExportError(t('Integrations.exportFailed'));return;}
      setExported({path:result.value.artifactPath,revealed:result.value.revealed});
    }catch {if(active.current&&sameView())setExportError(t('Integrations.exportFailed'));}
    finally {if(active.current&&sameView()){exportBusy.current=false;setExporting(false);}}
  };
  const revealExport = async () => {
    if(!exported||exportBusy.current)return;const path=exported.path;exportBusy.current=true;setExporting(true);setExportError('');
    try {await host.sdk.localAppClient.storage.assets.reveal(path);if(active.current&&sameView())setExported({path,revealed:true});}
    catch {if(active.current&&sameView())setExportError(t('Integrations.exportSavedRevealFailed',{path}));}
    finally {if(active.current&&sameView()){exportBusy.current=false;setExporting(false);}}
  };
  return <div className="h-full overflow-y-auto p-5" data-testid="lab-integrations-panel"><div className="mx-auto flex max-w-5xl flex-col gap-5">
    <header><h1 className="text-2xl font-semibold">{t('Integrations.title')}</h1><p className="mt-2 text-sm text-[var(--nimi-text-secondary)]">{t('Integrations.description')}</p></header>
    {scopeNotice?<InlineAlert tone="warning">{t('Integrations.sessionEnded')}</InlineAlert>:null}
    {refreshError?<InlineAlert tone="warning">{refreshError}</InlineAlert>:null}
    {error?<InlineAlert tone="warning">{error}</InlineAlert>:null}{notice?<InlineAlert tone="info">{notice}</InlineAlert>:null}
    <div className="flex flex-wrap gap-3"><Button tone="secondary" disabled={locked} onClick={()=>void refresh()}>{t('Integrations.refresh')}</Button><Button tone="secondary" onClick={()=>{setError('');setNotice('');void openDesktopIntent({intent:{kind:'open-integrations'}}).then(result=>{if(result.status==='rejected')throw new Error(t('Integrations.openRejected',{reason:result.reasonCode}));setNotice(t('Integrations.returnRefresh'));}).catch(report);}}>{t('Integrations.manageInHome')}</Button></div>
    {!targets.length?<InlineAlert tone="info">{t('Integrations.empty')}</InlineAlert>:null}
    <Surface tone="panel" className="flex flex-col gap-4">
      <label className="text-sm">{t('Integrations.target')}<select className={field} disabled={locked} value={targetRef} onChange={event=>changeTarget(event.target.value)}><option value="">{t('Integrations.selectTarget')}</option>{targets.map(item=><option key={item.targetRef} value={item.targetRef}>{item.displayName}{item.accountLabel&&!item.displayName.includes(item.accountLabel)?` · ${item.accountLabel}`:''}</option>)}</select></label>
      {target&&!target.available?<InlineAlert tone="warning">{t('Integrations.connectionUnavailable')}</InlineAlert>:null}
      {target&&!target.permittedOperations.length?<InlineAlert tone="info">{t('Integrations.permissionRequired')}</InlineAlert>:null}
      {target&&['weixin','feishu','qq-official','onebot-v11'].includes(target.kind)?<NativeMessagePanel key={target.targetRef} target={target} busy={locked} receiving={receivingBusy} stopping={receiveStopping} stopReceiving={stopReceiving} receiveStatus={receiveCall?`${t(`Integrations.states.${receiveCall.status}`)} · ${receiveCall.callId}${receiveCall.errorCode?` · ${t(`Integrations.errors.${receiveCall.errorCode}`,{defaultValue:receiveCall.errorCode})}`:''}`:''} receiveNotice={receiveNotice} receiveError={receiveError} receivedCount={receivedCount} events={events} saveReceived={saveReceived} setSaveReceived={setSaveReceived} setAssetBusy={setAssetBusy} saveEvent={saveReceivedBatch} invoke={invoke} recordAI={recordAI} recordReplyCall={(inputJson,next)=>save(target,inputJson,next)} report={report}/>:null}
      <details className="text-sm"><summary>{t('Integrations.advancedOperations')}</summary>
      <label className="mt-3 block text-sm">{t('Integrations.operation')}<select className={field} disabled={locked} value={operation} onChange={event=>{setOperation(event.target.value);setInput('{}');}}><option value="">{t('Integrations.selectOperation')}</option>{target?.operations.map(item=><option key={item.name} value={item.name} disabled={!target.permittedOperations.includes(item.name)}>{item.name} · {t(`Integrations.effects.${item.effect}`)}</option>)}</select></label>
      {descriptor?<><p className="text-sm">{descriptor.description}</p><details className="text-sm"><summary>{t('Integrations.inputSchema')}</summary><pre className="mt-2 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(JSON.parse(descriptor.inputSchemaJson),null,2)}</pre></details></>:null}
      <label className="text-sm">{t('Integrations.input')}<textarea className={`${field} min-h-40 font-mono`} value={input} maxLength={256*1024} disabled={locked} onChange={event=>setInput(event.target.value)}/></label>
      <p className="text-xs text-[var(--nimi-text-secondary)]">{t('Integrations.noResend')}</p>
      <p className="text-xs text-[var(--nimi-text-secondary)]">{t('Integrations.bodyPrivacy')}</p>
      <Button className="mt-3" disabled={busy || !target?.available || !descriptor || !target.permittedOperations.includes(operation)} onClick={()=>void invoke()}>{t('Integrations.invoke')}</Button>
      </details>
      <Button tone="secondary" disabled={!busy} onClick={()=>void stop()}>{t('Integrations.stop')}</Button>
      {call?<div data-testid="integration-call"><p className="text-sm" role="status" aria-live="polite" aria-atomic="true">{t(`Integrations.states.${call.status}`)} · {call.callId}{call.errorCode?` · ${t(`Integrations.errors.${call.errorCode}`,{defaultValue:call.errorCode})}`:''}</p>{receipt?<div className="mt-2 text-sm"><p>{t(`Integrations.confirmations.${receipt.confirmation}`)}</p><p>{receipt.messageId?`${t('Integrations.nativeMessageId')}: ${receipt.messageId}`:t('Integrations.noNativeMessageId')}</p><p className="mt-1 text-xs">{t('Integrations.receiptBoundary')}</p></div>:null}{call.status==='unconfirmed'?<InlineAlert tone="warning">{t('Integrations.noResend')}</InlineAlert>:null}{call.resultJson?<pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(JSON.parse(call.resultJson),null,2)}</pre>:null}{history.find(record=>record.callId===call.callId)?<HistoricalIntegrationAssets record={history.find(record=>record.callId===call.callId)!}/>:null}<Button className="mt-3" size="sm" tone="secondary" disabled={locked} onClick={()=>void savePrivateBody()}>{t('Integrations.saveBody')}</Button></div>:null}
    </Surface>
    <IntegrationAssetsPanel busy={locked} setAssetBusy={setAssetBusy}/>
    <Surface tone="panel"><div className="flex items-center justify-between gap-3"><h2 className="font-semibold">{t('Integrations.history')}</h2><Button tone="secondary" disabled={!history.length||exporting} onClick={()=>void exportHistory()}>{t('Integrations.export')}</Button></div>
      {exportError?<InlineAlert className="mt-3" tone="warning" data-testid="integration-export-error" aria-live="polite" aria-atomic="true">{exportError}</InlineAlert>:null}
      {historyError?<InlineAlert tone="warning">{t('Integrations.historyLoadFailed',{detail:historyError})}</InlineAlert>:null}
      {exported?<div className="mt-3 text-sm" data-testid="integration-export-result"><p role="status">{t(exported.revealed?'Integrations.exportSaved':'Integrations.exportSavedRevealFailed',{path:exported.path})}</p><p className="mt-1 break-all">{exported.path}</p><Button className="mt-2" size="sm" tone="secondary" disabled={exporting} onClick={()=>void revealExport()}>{t('Integrations.revealAsset')}</Button></div>:null}
      {!history.length&&!historyError?<p className="mt-3 text-sm">{t('Integrations.noHistory')}</p>:null}
      <p className="mt-3 text-xs">{t('Integrations.historyRemoveHelp')}</p>
      {history.map(record=><div key={record.id} className="mt-4 border-t border-[var(--nimi-border-subtle)] pt-3 text-sm" data-testid="integration-history-row"><p>{record.targetDisplayName} · {record.operation} · {t(`Integrations.states.${record.status}`)}</p><p className="mt-1 break-all text-xs"><time dateTime={record.createdAt}>{new Date(record.createdAt).toLocaleString(i18n.language)}</time> · {record.callId}</p>{historyBusy.includes(record.id)?<p className="mt-1 text-xs">{t('Integrations.historyUpdating')}</p>:null}<div className="mt-2 flex gap-2"><Button size="sm" tone="secondary" aria-expanded={savedRecordId===record.id} aria-controls={`saved-${record.id}`} onClick={event=>{savedTrigger.current=event.currentTarget;setSavedRecordId(record.id);}}>{t('Integrations.viewSaved')}</Button><Button size="sm" tone="secondary" disabled={locked||historyBusy.includes(record.id)} onClick={()=>void observe(record)}>{t('Integrations.observe')}</Button><Button size="sm" tone="danger" disabled={locked||historyBusy.includes(record.id)} onClick={()=>void remove(record)}>{t('Integrations.remove')}</Button></div>
        {savedRecordId===record.id?<div ref={savedDetail} id={`saved-${record.id}`} tabIndex={-1} className="mt-4 rounded-xl border border-[var(--nimi-border-subtle)] p-4" data-testid="integration-saved-record" aria-label={t('Integrations.savedRecord')}><IntegrationSavedRecord record={record}/><Button className="mt-3" size="sm" tone="secondary" onClick={closeSaved}>{t('Integrations.closeSaved')}</Button></div>:null}
      </div>)}
    </Surface>
  </div></div>;
}
