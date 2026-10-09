import { NativeMessageContent, NativeMessageReferences } from './native-message-content.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { NimiIntegrationCall, NimiIntegrationTarget } from '@nimiplatform/sdk/app';
import { Button, InlineAlert } from '@nimiplatform/kit/ui';
import { useLabRendererHost } from '../../renderer/context.js';
import { useTranslation } from '../../shell/i18n/index.js';
import { nativeConversations, nativeEventKey, nativeReadInput, type NativeEvent } from './native-message-model.js';
import { NativeReplyPanel } from './native-reply-panel.js';
import { subscribeLabLocalAppSessionLoss } from '../../shell/auth/session-loss.js';
import type { StudioRunHistoryRecord } from '../../ai-studio-core/history.js';

const field = 'mt-1 w-full rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-3 text-sm';
type Asset = Readonly<{ relativePath: string; sha256: string; mediaType: string; sizeBytes: number }>;
// @nimi-authority: rule.nimi.runtime.integration.qq-onebot-protocol
export function NativeMessagePanel({ target, busy, receiving=false, stopping=false, stopReceiving, receiveStatus='', receiveNotice='', receiveError='', receivedCount=0, events, saveReceived, setSaveReceived, setAssetBusy, saveEvent, invoke, recordAI, recordReplyCall, report }: {
  target: NimiIntegrationTarget; busy: boolean; events: readonly NativeEvent[];
  receiving?:boolean; stopping?:boolean; stopReceiving?:()=>void; receiveStatus?:string; receiveNotice?:string; receiveError?:string; receivedCount?:number;
  saveReceived:boolean; setSaveReceived:(value:boolean)=>void;
  setAssetBusy:(value:boolean)=>void; saveEvent:(eventId:string)=>Promise<void>;
  invoke: (operation: string, input: string, receiving?: boolean) => Promise<void>;
  recordReplyCall: (inputJson: string, call: NimiIntegrationCall) => Promise<void>;
  recordAI: (record: StudioRunHistoryRecord) => Promise<void>;
  report: (error: unknown) => void;
}) {
  const { t } = useTranslation(); const host = useLabRendererHost();
  const [action,setAction] = useState<'send'|'reply'|'update'>('send');
  const [conversationKind,setConversationKind] = useState(nativeConversations(target.kind)[0]!);
  const [recipient,setRecipient] = useState(''); const [bodyKind,setBodyKind] = useState('text');
  const [text,setText] = useState(''); const [card,setCard] = useState('{"elements":[]}');
  const [messageId,setMessageId] = useState('');
  const [replySelection,setReplySelection] = useState<{host:typeof host;event:NativeEvent} | null>(null);
  const reply=replySelection?.host===host?replySelection.event:null;
  const setReply=(event:NativeEvent)=>setReplySelection({host,event});
  const [filters,setFilters] = useState(''); const [asset,setAsset] = useState<Asset | null>(null);
  const [fileName,setFileName] = useState(''); const [importing,setImporting] = useState(false);
  const [ownedImports,setOwnedImports] = useState<readonly Asset[]>([]);
  const [assetCursor,setAssetCursor] = useState('');
  const [scopeNotice,setScopeNotice] = useState(false);
  const [replyBusy,setReplyBusy] = useState(false);
  const changeReplyBusy = useCallback((value:boolean)=>{setReplyBusy(value);setAssetBusy(value);},[setAssetBusy]);
  const live = useRef(false);
  const currentHost = useRef(host); const scopeVersion = useRef(0);
  if(currentHost.current!==host){scopeVersion.current++;currentHost.current=host;}
  const version=scopeVersion.current;
  const isCurrent = () => live.current&&currentHost.current===host&&scopeVersion.current===version;
  const [downloadPath,setDownloadPath] = useState('');
  const clearTransient = () => {
    setReplySelection(null);setText('');setCard('{"elements":[]}');setMessageId('');setRecipient('');setFilters('');setAsset(null);setOwnedImports([]);setAssetCursor('');setFileName('');setDownloadPath('');setImporting(false);
  };
  const loadAssets = async (cursor='') => {
    const page = await host.sdk.localAppClient.storage.assets.list({prefix:'integration-outbound/',pageSize:100,cursor});
    if (!isCurrent()) return;
    const assets = page.assets.map(item=>({relativePath:item.relativePath,sha256:item.sha256,mediaType:item.mediaType||'application/octet-stream',sizeBytes:item.sizeBytes}));
    setOwnedImports(current=>cursor?[...new Map([...current,...assets].map(item=>[item.relativePath,item])).values()]:assets);
    setAssetCursor(page.nextCursor);
  };
  useEffect(() => {
    live.current=true;
    clearTransient();setScopeNotice(false);
    setSaveReceived(false);
    void loadAssets().catch(report);
    const unsubscribe=subscribeLabLocalAppSessionLoss(()=>{if(!live.current||currentHost.current!==host)return;scopeVersion.current++;clearTransient();setScopeNotice(true);setAssetBusy(false);});
    return()=>{live.current=false;setAssetBusy(false);unsubscribe();};
  }, [host]);
  const allowed = (suffix:string) => target.available && target.permittedOperations.includes(`${target.kind}.${suffix}`);
  const importFile = async (file: File | undefined) => {
    if (!file || busy || importing) return;
    setImporting(true);setAssetBusy(true);
    try {
      const limit=(target.kind==='onebot-v11'?4:target.kind==='qq-official'?20:32)*1024*1024;
      if (!file.size || file.size > limit || /[\\/\u0000\r\n]/u.test(file.name)) throw new Error(t('Integrations.mediaInvalid'));
      const mediaType = file.type || 'application/octet-stream';
      const saved = await host.sdk.localAppClient.storage.assets.write({ relativePath:`integration-outbound/${crypto.randomUUID()}/${file.name}`,body:file,mediaType,overwrite:false });
      const next:Asset = {relativePath:saved.relativePath,sha256:saved.sha256,mediaType:saved.mediaType || mediaType,sizeBytes:saved.sizeBytes};
      if (!isCurrent()) return;
      setAsset(next);setFileName(file.name);setOwnedImports(current => [...current,next]);
    } catch (error) { if(isCurrent())report(error); } finally { if(isCurrent()){setImporting(false);setAssetBusy(false);} }
  };
  const assetAction = async (action:()=>Promise<void>) => {
    if(busy||importing)return;
    setImporting(true);setAssetBusy(true);
    try{await action();}catch(error){if(isCurrent())report(error);}
    finally{if(isCurrent()){setImporting(false);setAssetBusy(false);}}
  };
  const send = async () => {
    try {
      const operation = `${target.kind}.messages.${action}`;
      let body:unknown;
      if(bodyKind==='text'){if(!text.trim())throw new Error(t('Integrations.messageRequired'));body={kind:'text',text};}
      else if(bodyKind==='card'){JSON.parse(card);body={kind:'card',cardJson:card};}
      else {if(!asset)throw new Error(t('Integrations.assetRequired'));body={kind:bodyKind,asset,...(bodyKind==='file'?{fileName}:{})};}
      let input:unknown;
      if(action==='reply'){if(!reply)throw new Error(t('Integrations.selectReceived'));input={replyRef:reply.replyRef,body};}
      else if(action==='update'){if(!messageId)throw new Error(t('Integrations.messageIdRequired'));input={messageId,body};}
      else {if(!recipient.trim())throw new Error(t('Integrations.recipientRequired'));const conversation={kind:conversationKind,id:recipient.trim()};
        const needsContext=target.kind==='weixin'||target.kind==='qq-official';
        if(needsContext&&(!reply||reply.conversation.kind!==conversation.kind||reply.conversation.id!==conversation.id))throw new Error(t(target.kind==='qq-official'?'Integrations.qqContextRequired':'Integrations.weixinContextRequired'));
        input={conversation,body,...(needsContext?{contextRef:reply!.replyRef}:{})};}
      await invoke(operation,JSON.stringify(input));
    } catch(error){report(error);}
  };
  return <div className="flex flex-col gap-4" data-testid="native-message-panel">
    <h2 className="font-semibold">{t('Integrations.messages')}</h2>
    {scopeNotice?<InlineAlert tone="warning">{t('Integrations.errors.LAB_INTEGRATION_REPLY_SCOPE_ENDED')}</InlineAlert>:null}
    <label>{t('Integrations.messageAction')}<select className={field} disabled={busy||importing} value={action} onChange={event=>{setAction(event.target.value as typeof action);if(event.target.value==='update')setBodyKind('text');}}><option value="send">{t('Integrations.sendMessage')}</option><option value="reply">{t('Integrations.replyMessage')}</option>{target.kind==='feishu'?<option value="update">{t('Integrations.updateMessage')}</option>:null}</select></label>
    {action==='send'?<div className="grid gap-3 sm:grid-cols-[10rem_1fr]"><label>{t('Integrations.conversationKind')}<select className={field} disabled={busy} value={conversationKind} onChange={event=>setConversationKind(event.target.value)}>{nativeConversations(target.kind).map(kind=><option key={kind} value={kind}>{t(`Integrations.conversationKinds.${kind}`)}</option>)}</select></label><label>{t('Integrations.recipient')}<input className={field} value={recipient} maxLength={256} disabled={busy} onChange={event=>setRecipient(event.target.value)}/></label></div>:null}
    {target.kind==='weixin'?<p className="text-sm">{t('Integrations.weixinContextRequired')}</p>:null}
    {target.kind==='feishu'?<p className="text-sm">{t('Integrations.feishuConversationsHelp')}</p>:null}
    {target.kind==='qq-official'?<p className="text-sm">{t('Integrations.qqContextRequired')}</p>:null}
    {target.kind==='onebot-v11'?<p className="text-sm">{t('Integrations.onebotMediaHelp')}</p>:null}
    {action==='reply'?<p className="text-sm">{reply?`${reply.senderId} · ${reply.messageId || reply.eventId}`:t('Integrations.selectReceived')}</p>:null}
    {action==='update'?<label>{t('Integrations.nativeMessageId')}<input className={field} value={messageId} maxLength={256} disabled={busy} onChange={event=>setMessageId(event.target.value)}/></label>:null}
    <label>{t('Integrations.messageBodyKind')}<select className={field} value={bodyKind} disabled={busy||importing} onChange={event=>setBodyKind(event.target.value)}><option value="text">{t('Integrations.bodyKinds.text')}</option>{action!=='update'?<><option value="image">{t('Integrations.bodyKinds.image')}</option>{target.kind!=='onebot-v11'?<option value="file">{t('Integrations.bodyKinds.file')}</option>:null}</>:null}{target.kind==='feishu'?<option value="card">{t('Integrations.bodyKinds.card')}</option>:null}</select></label>
    {bodyKind==='text'?<label>{t('Integrations.messageText')}<textarea className={`${field} min-h-28`} value={text} maxLength={32768} disabled={busy} onChange={event=>setText(event.target.value)}/></label>:bodyKind==='card'?<label>{t('Integrations.cardJson')}<textarea className={`${field} min-h-32 font-mono`} value={card} maxLength={65536} disabled={busy} onChange={event=>setCard(event.target.value)}/></label>:<><label>{t('Integrations.importAsset')}<input className={field} type="file" accept={bodyKind==='image'?'image/png,image/jpeg,image/webp,image/gif':undefined} disabled={busy||importing} onChange={event=>{const file=event.target.files?.[0];event.target.value='';void importFile(file);}}/></label>{asset?<p className="break-all text-xs">{asset.relativePath} · {asset.sizeBytes} bytes</p>:null}{bodyKind==='file'?<label>{t('Integrations.fileName')}<input className={field} value={fileName} maxLength={255} disabled={busy} onChange={event=>setFileName(event.target.value)}/></label>:null}</>}
    <Button disabled={busy||importing||!allowed(`messages.${action}`)} onClick={()=>void send()}>{t(`Integrations.${action==='reply'?'replyMessage':action==='update'?'updateMessage':'sendMessage'}`)}</Button>
    <NativeReplyPanel target={target} event={reply} externalBusy={busy&&!replyBusy} setBusy={changeReplyBusy} recordAI={recordAI} recordCall={recordReplyCall}/>
    {ownedImports.length||assetCursor?<details className="text-sm"><summary>{t('Integrations.outboundAssets')}</summary>{ownedImports.map(item=><div key={item.relativePath} className="mt-2 flex flex-wrap items-center gap-2"><span className="min-w-0 flex-1 break-all text-xs">{item.relativePath}</span><Button size="sm" tone="secondary" disabled={busy||importing||(target.kind==='onebot-v11'&&!item.mediaType.startsWith('image/'))} onClick={()=>{if(action==='update')setAction('send');setAsset(item);setFileName(item.relativePath.split('/').at(-1)||'');setBodyKind(item.mediaType.startsWith('image/')?'image':'file');}}>{t('Integrations.selectAsset')}</Button><Button size="sm" tone="danger" disabled={busy||importing} onClick={()=>void assetAction(async()=>{await host.sdk.localAppClient.storage.assets.remove(item.relativePath);if(!isCurrent())return;setOwnedImports(current=>current.filter(value=>value.relativePath!==item.relativePath));if(asset?.relativePath===item.relativePath)setAsset(null);})}>{t('Integrations.removeAsset')}</Button></div>)}{assetCursor?<Button className="mt-3" size="sm" tone="secondary" disabled={busy||importing} onClick={()=>void assetAction(()=>loadAssets(assetCursor))}>{t('Integrations.moreAssets')}</Button>:null}</details>:null}
    <div className="border-t border-[var(--nimi-border-subtle)] pt-4" data-testid="integration-reception"><h2 className="font-semibold">{t('Integrations.receiveMessages')}</h2><p className="mt-2 text-xs">{t('Integrations.filtersHelp')}</p><details className="mt-3 text-sm"><summary>{t('Integrations.conversationFilters')}</summary><label className="mt-2 block">{t('Integrations.conversationFilters')}<textarea className={field} value={filters} disabled={receiving} maxLength={32768} placeholder={`${conversationKind}:${recipient||'id'}`} onChange={event=>setFilters(event.target.value)}/></label></details><div className="mt-3 flex flex-wrap gap-2"><Button tone="secondary" disabled={receiving||busy||importing||!allowed('updates.read')} onClick={()=>{try{void invoke(`${target.kind}.updates.read`,nativeReadInput(filters),true);}catch(error){report(error);}}}>{t('Integrations.startReceive')}</Button><Button tone="secondary" disabled={!receiving} onClick={stopReceiving}>{t('Integrations.stopReceive')}</Button></div><p className="mt-2 text-sm" role="status" aria-live="polite" aria-atomic="true">{receiving?t(stopping?'Integrations.receiveStopping':'Integrations.receiving'):t('Integrations.receiveIdle')}{receiveStatus?` · ${receiveStatus}`:''}</p>{receiveNotice?<InlineAlert tone="info">{receiveNotice}</InlineAlert>:null}{receiveError?<InlineAlert tone="warning">{receiveError}</InlineAlert>:null}<p className="mt-2 text-sm" role="status" aria-live="polite" aria-atomic="true">{t('Integrations.receivedCount',{count:receivedCount})}</p></div>
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={saveReceived} disabled={receiving} onChange={event=>setSaveReceived(event.target.checked)}/>{t('Integrations.saveReceivedBodies')}</label>
    <label>{t('Integrations.downloadPath')}<input className={field} value={downloadPath} disabled={busy} maxLength={1024} placeholder="received/image.png" onChange={event=>setDownloadPath(event.target.value)}/></label>
    {!events.length?<p className="text-sm">{t('Integrations.noMessages')}</p>:null}
    {events.map(event=><article key={nativeEventKey(target.kind,event)} className="rounded-xl border border-[var(--nimi-border-subtle)] p-3 text-sm"><p className="break-all">{event.conversation.kind}:{event.conversation.id} · {event.senderId}</p><p className="mt-1 text-xs">{event.platformTime || event.receivedAt}</p><NativeMessageContent event={event} mediaDisabled={busy||!downloadPath.trim()||!allowed('media.fetch')} fetchMedia={mediaRef=>void invoke(`${target.kind}.media.fetch`,JSON.stringify({mediaRef,relativePath:downloadPath.trim()}))} /><NativeMessageReferences event={event} mediaDisabled={busy||!downloadPath.trim()||!allowed('media.fetch')} fetchMedia={mediaRef=>void invoke(`${target.kind}.media.fetch`,JSON.stringify({mediaRef,relativePath:downloadPath.trim()}))} /><div className="mt-3 flex flex-wrap gap-2"><Button tone="secondary" size="sm" disabled={busy} onClick={()=>{setReply(event);setAction('reply');setConversationKind(event.conversation.kind);setRecipient(event.conversation.id);}}>{t('Integrations.useReplyContext')}</Button><Button tone="secondary" size="sm" disabled={busy} onClick={()=>void saveEvent(nativeEventKey(target.kind,event)).catch(report)}>{t('Integrations.saveReceivedBatch')}</Button></div></article>)}
    <InlineAlert tone="info">{t('Integrations.transientMessages')}</InlineAlert>
  </div>;
}
