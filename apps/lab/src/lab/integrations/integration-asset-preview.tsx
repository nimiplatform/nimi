import { useEffect, useState } from 'react';
import type { NimiLocalAppAssetRecord } from '@nimiplatform/sdk/app';
import { Button } from '@nimiplatform/kit/ui';
import { openNimiLocalAppAssetMediaUrl } from '@nimiplatform/kit/shell/renderer/bridge';
import { useLabRendererHost } from '../../renderer/context.js';
import { useTranslation } from '../../shell/i18n/index.js';

// Only an already owned App asset can acquire a short-lived Kit media handle.
// No upstream URL or private Integration source is used for display.
export function IntegrationAssetPreview({ relativePath, disabled, report }: {
  relativePath:string; disabled:boolean; report:(cause:unknown)=>void;
}) {
  const host=useLabRendererHost();const {t}=useTranslation();
  const [asset,setAsset]=useState<NimiLocalAppAssetRecord|null>(null);
  const [requested,setRequested]=useState(false);const [url,setUrl]=useState('');
  useEffect(()=>{
    let live=true;setAsset(null);setRequested(false);setUrl('');
    void host.sdk.localAppClient.storage.assets.stat(relativePath).then(next=>{if(live)setAsset(next);}).catch(cause=>{if(live)report(cause);});
    return()=>{live=false;};
  },[host,relativePath]);
  useEffect(()=>{
    if(!requested||!asset)return;
    let live=true;let revoke:(()=>Promise<void>)|undefined;
    void openNimiLocalAppAssetMediaUrl(relativePath).then(handle=>{
      revoke=handle.revoke;if(live)setUrl(handle.url);else void handle.revoke();
    }).catch(cause=>{if(live){setRequested(false);report(cause);}});
    return()=>{live=false;if(revoke)void revoke();};
  },[host,requested,asset,relativePath]);
  const mediaType=asset?.mediaType||'application/octet-stream';
  const previewable=/^(image\/(png|jpeg|webp|gif)|audio\/(mpeg|mp3|wav|x-wav|ogg)|video\/(mp4|webm))$/u.test(mediaType);
  return <div className="mt-3 rounded-xl border border-[var(--nimi-border-subtle)] p-3 text-xs">
    <p className="break-all">{relativePath}</p>
    {asset?<><p className="mt-1">{mediaType} · {t('Integrations.assetSize',{size:asset.sizeBytes})}</p><p className="mt-1 break-all">{asset.sha256}</p></>:null}
    <div className="mt-2 flex gap-2"><Button size="sm" tone="secondary" disabled={disabled||!asset} onClick={()=>void host.sdk.localAppClient.storage.assets.reveal(relativePath).catch(report)}>{t('Integrations.revealAsset')}</Button>{previewable?<Button size="sm" tone="secondary" disabled={disabled||requested} onClick={()=>setRequested(true)}>{t('Integrations.previewAsset')}</Button>:null}</div>
    {url&&mediaType.startsWith('image/')?<img className="mt-3 max-h-96 max-w-full object-contain" src={url} alt={relativePath} onError={()=>{setRequested(false);setUrl('');report(new Error(t('Integrations.previewFailed')));}}/>:null}
    {url&&mediaType.startsWith('audio/')?<audio className="mt-3 w-full" controls src={url}/>:null}
    {url&&mediaType.startsWith('video/')?<video className="mt-3 max-h-96 max-w-full" controls src={url}/>:null}
  </div>;
}
