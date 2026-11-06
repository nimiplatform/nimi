import assert from 'node:assert/strict';
import test from 'node:test';
import { createNimiAiRealtimeRuntimeClient } from './local-app-runtime-platform-direct-ai-realtime.js';
import { AiRealtimeAudioCodec, AiRealtimeInteractionMode, type AiRealtimeEvent } from '../../core-generated/runtime-protobuf/runtime/v1/ai_realtime.js';

test('continuous Realtime preserves explicit mode, session-scoped audio, context and cumulative usage', async () => {
  const control = { realtimeSessionId:'session',channelId:'channel',subscriptionId:'',adapterKind:3,lifecycle:2,generation:'1',sequence:'0',correlationId:'',backpressure:1,bufferedItems:0,bufferCapacity:128,terminalReason:0,actionHint:'',occurredAt:undefined };
  const format = {codec:AiRealtimeAudioCodec.PCM_S16LE,sampleRateHz:24000,channelCount:1,frameDurationMs:20,maximumFrameBytes:960};
  const publicFormat = {...format,codec:'pcm-s16le' as const,channelCount:1 as const};
  const scope={realtimeSessionId:'session',generation:'1'};
  const calls: unknown[]=[];
  const events: AiRealtimeEvent[]=[
    {control,event:{oneofKind:'opened',opened:{inputAudio:format,outputAudio:format,turnDetection:0,interactionMode:2}}},
    {control,event:{oneofKind:'continuousTranscript',continuousTranscript:{direction:1,textDelta:' hello ',startMs:'0',endMs:'120'}}},
    {control,event:{oneofKind:'contextRequest',contextRequest:{contextRequestId:'runtime-context',offsetMs:'120'}}},
    {control,event:{oneofKind:'audioFrame',audioFrame:{requestId:'',outputTrackId:'stream-output',frameSequence:'1',frame:new Uint8Array([0,0]),format}}},
    {control,event:{oneofKind:'sessionUsage',sessionUsage:{audioSeconds:2.5,final:false}}},
    {control,event:{oneofKind:'continuousTranscript',continuousTranscript:{direction:2,textDelta:' untimed '}}},
    {control,event:{oneofKind:'continuousInterruption',continuousInterruption:{outputTrackId:''}}},
    {control:{...control,lifecycle:5,terminalReason:12},event:{oneofKind:'sessionTerminal',sessionTerminal:{reasonCode:0,usage:{audioSeconds:4.8,final:true},closure:{localResourcesReleased:true,providerSessionClosed:true}}}},
  ];
  const client=createNimiAiRealtimeRuntimeClient({
    async openRealtimeSession(request) {calls.push(request);return {...scope,channelId:'channel',negotiatedInputAudio:format,negotiatedOutputAudio:format,interactionMode:request.interactionMode,control};},
    async appendRealtimeInput(request) {calls.push(request);return {ack:{ok:true,reasonCode:0,actionHint:''},control};},
    async submitRealtimeOwnerControl(request) {calls.push(request);return {ack:{ok:true,reasonCode:0,actionHint:''},control};},
    readRealtimeEvents() {return (async function*(){yield* events;})();},
    async interruptRealtimeOutput() {throw new Error('not admitted');},
    async closeRealtimeSession() {return {ack:{ok:true,reasonCode:0,actionHint:''},control:{...control,lifecycle:5,terminalReason:12},usage:{audioSeconds:4.8,final:true},closure:{localResourcesReleased:true,providerSessionClosed:true}};},
  });
  const opened=await client.open({interactionMode:'continuous',inputAudio:publicFormat,audioOutputEnabled:true,initialInstruction:'Caller owns actions.'});
  assert.equal(opened.interactionMode,'continuous');
  assert.equal((calls[0] as {interactionMode:number}).interactionMode,AiRealtimeInteractionMode.CONTINUOUS);
  assert.equal((calls[0] as {turnDetection:number}).turnDetection,0);
  await client.appendInput({...scope,input:{type:'audio-frame',inputTrackId:'stream-input',utteranceId:'',frameSequence:'1',frame:new Uint8Array([0,0])}});
  await client.appendInput({...scope,input:{type:'owner-context',requestId:'reply',kind:'sanitized-result',text:'App-prepared result',contextRequestId:'runtime-context'}});
  assert.equal((calls[2] as {input:{ownerContext:{contextRequestId:string}}}).input.ownerContext.contextRequestId,'runtime-context');
  await client.submitOwnerControl({...scope,requestId:'mute',control:'mute-input'});
  assert.equal((calls[3] as {control:number}).control,6);
  const observed=[];for await(const envelope of await client.subscribe(scope))observed.push(envelope);
  assert.deepEqual(observed[1]!.event,{type:'continuous-transcript',direction:'input',textDelta:' hello ',startMs:0,endMs:120});
  assert.equal(observed[3]!.event.type,'audio-frame');
  assert.deepEqual(observed[5]!.event,{type:'continuous-transcript',direction:'output',textDelta:' untimed '});
  assert.deepEqual(observed[6]!.event,{type:'continuous-interruption',outputTrackId:''});
  assert.equal(observed.at(-1)!.control.terminalReason,'completed');
  assert.deepEqual((await client.close(scope)).usage,{audioSeconds:4.8,final:true});
  assert.deepEqual((await client.close(scope)).closure,{localResourcesReleased:true,providerSessionClosed:true});
  events.splice(0,events.length,{control,event:{oneofKind:'continuousTranscript',continuousTranscript:{direction:1,textDelta:'incomplete timestamp pair',startMs:'0'}}});
  await assert.rejects(async()=>{for await(const _ of await client.subscribe(scope)){ /* validation must reject the partial native range */ }});
  await assert.rejects(client.open({interactionMode:'continuous',inputAudio:publicFormat,audioOutputEnabled:true,initialInstruction:'',turnDetection:'manual'} as never));
});
