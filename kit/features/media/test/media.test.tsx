import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi } from 'vitest';
import { MediaVideo } from '../src/media-video.js';
import { MediaImage } from '../src/media-image.js';
import type { MediaDeliveryDto } from '../../../core/src/sdk-contract.js';

const delivery: MediaDeliveryDto = { resourceId:'video-1', contentVersion:'a'.repeat(64), publicationGeneration:1, policyVersion:'v1',
  expiresAt:'2099-01-01T00:00:00Z', images:[], previewUrl:null, originalUrl:'https://media.example/original.bin',
  video:{hlsUrl:'https://video.example/token/manifest/video.m3u8',dashUrl:'https://video.example/token/manifest/video.mpd',posterUrl:'https://media.example/poster.webp',expiresAt:'2099-01-01T00:00:00Z'} };

describe('bounded image transport recovery', () => {
 const picture: MediaDeliveryDto = { ...delivery, resourceId: 'picture', expiresAt: null, video: null,
  images: [{ purpose: 'chat', families: [{ mimeType: 'image/webp', sources: [{ url: 'https://media.example/chat.webp', width: 320, height: 180, mimeType: 'image/webp' }] }] }] };
 it('retries an unchanged authorized URL once and then shows failure, without original fallback', async () => {
  const element=document.createElement('div');document.body.append(element);const root=createRoot(element);
  const refresh=vi.fn(async()=>picture);const unavailable=vi.fn();
  try{
   await act(async()=>root.render(<MediaImage delivery={picture} purpose="chat" sizes="320px" refresh={refresh} onUnavailable={unavailable}/>));
   const first=element.querySelector('img')!;
   await act(async()=>{first.dispatchEvent(new Event('error'));});
   const retry=element.querySelector('img')!;expect(retry).not.toBe(first);expect(retry.src).toBe(first.src);
   expect(unavailable).not.toHaveBeenCalled();
   await act(async()=>{retry.dispatchEvent(new Event('error'));});
   expect(refresh).toHaveBeenCalledTimes(1);expect(unavailable).toHaveBeenCalledTimes(1);expect(element.querySelector('img')).toBeNull();
  }finally{await act(async()=>root.unmount());element.remove();}
 });
 it('does not retry when the business read no longer authorizes the image', async()=>{
  const element=document.createElement('div');document.body.append(element);const root=createRoot(element);const unavailable=vi.fn();
  try{
   await act(async()=>root.render(<MediaImage delivery={picture} externalUrl="https://media.example/original.png" purpose="chat" sizes="320px" refresh={async()=>null} onUnavailable={unavailable}/>));
   await act(async()=>{element.querySelector('img')!.dispatchEvent(new Event('error'));});
   expect(element.querySelector('img')).toBeNull();expect(unavailable).toHaveBeenCalledTimes(1);
  }finally{await act(async()=>root.unmount());element.remove();}
 });
 it('a changed grant still shares the original one-retry budget', async()=>{
  const element=document.createElement('div');document.body.append(element);const root=createRoot(element);const unavailable=vi.fn();
  const refresh=vi.fn(async()=>({...picture,expiresAt:'2099-01-01T00:00:00Z'}));
  try{
   await act(async()=>root.render(<MediaImage delivery={{...picture,expiresAt:'2000-01-01T00:00:00Z'}} purpose="chat" sizes="320px" refresh={refresh} onUnavailable={unavailable}/>));
   await act(async()=>{element.querySelector('img')!.dispatchEvent(new Event('error'));});
   await act(async()=>{element.querySelector('img')!.dispatchEvent(new Event('error'));});
   expect(refresh).toHaveBeenCalledTimes(1);expect(unavailable).toHaveBeenCalledTimes(1);expect(element.querySelector('img')).toBeNull();
  }finally{await act(async()=>root.unmount());element.remove();}
 });
});

describe('shared media playback lifecycle',()=>{
 it('resumes native HLS after an expired grant even when initial preload is none',async()=>{
  const support=vi.spyOn(HTMLMediaElement.prototype,'canPlayType').mockReturnValue('probably');
  const load=vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(function(this:HTMLMediaElement){this.currentTime=0;});
  const play=vi.spyOn(HTMLMediaElement.prototype,'play').mockResolvedValue();
  const renewed={...delivery,video:{...delivery.video!,hlsUrl:'https://video.example/renewed/manifest/video.m3u8'}};
  const refresh=vi.fn(async()=>renewed);
  const element=document.createElement('div');document.body.append(element);const root=createRoot(element);
  try{
   await act(async()=>root.render(<MediaVideo delivery={{...delivery,expiresAt:'2000-01-01T00:00:00Z',video:{...delivery.video!,expiresAt:'2000-01-01T00:00:00Z'}}} refresh={refresh}/>));
   const player=element.querySelector('video')!;
   expect(player.preload).toBe('none');expect(play).not.toHaveBeenCalled();
   player.currentTime=2.2;Object.defineProperty(player,'readyState',{configurable:true,value:4});Object.defineProperty(player,'paused',{configurable:true,value:false});
   await act(async()=>{player.dispatchEvent(new Event('play'));});
   expect(refresh).toHaveBeenCalledTimes(1);expect(player.src).toBe(renewed.video.hlsUrl);
   expect(play).toHaveBeenCalled();
   await act(async()=>{player.dispatchEvent(new Event('loadedmetadata'));});
   expect(player.currentTime).toBe(2.2);
  }finally{await act(async()=>root.unmount());element.remove();support.mockRestore();load.mockRestore();play.mockRestore();}
 });
 it('keeps the same player alive when a parent receives an equivalent descriptor',async()=>{
  const support=vi.spyOn(HTMLMediaElement.prototype,'canPlayType').mockReturnValue('probably');
  const load=vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>undefined);
  const element=document.createElement('div');document.body.append(element);const root=createRoot(element);
  try {
   await act(async()=>{root.render(<MediaVideo delivery={delivery}/>);});
   const player=element.querySelector('video')!;expect(player.src).toBe(delivery.video!.hlsUrl);
   player.currentTime=1.7;Object.defineProperty(player,'readyState',{configurable:true,value:4});
   await act(async()=>{root.render(<MediaVideo delivery={{...delivery,video:{...delivery.video!}}}/>);});
   expect(element.querySelector('video')).toBe(player);expect(load).not.toHaveBeenCalled();
   await act(async()=>{root.render(<MediaVideo delivery={{...delivery,publicationGeneration:2,video:{...delivery.video!,hlsUrl:'https://video.example/new/manifest/video.m3u8'}}}/>);});
   expect(player.src).toContain('/new/manifest');expect(load).toHaveBeenCalledTimes(1);
   // Another read can renew the grant again before the new source has metadata.
   Object.defineProperty(player,'readyState',{configurable:true,value:0});player.currentTime=0;
   await act(async()=>{root.render(<MediaVideo delivery={{...delivery,publicationGeneration:3,video:{...delivery.video!,hlsUrl:'https://video.example/newer/manifest/video.m3u8'}}}/>);});
   player.currentTime=0;
   Object.defineProperty(player,'readyState',{configurable:true,value:4});
   await act(async()=>{player.dispatchEvent(new Event('loadedmetadata'));});
   expect(player.currentTime).toBe(1.7);
   await act(async()=>{root.render(<MediaVideo delivery={{...delivery,resourceId:'different-video'}}/>);});
   player.currentTime=0;
   await act(async()=>{player.dispatchEvent(new Event('loadedmetadata'));});
   expect(player.currentTime).toBe(0);
  } finally {await act(async()=>{root.unmount();});element.remove();support.mockRestore();load.mockRestore();}
 });
});
