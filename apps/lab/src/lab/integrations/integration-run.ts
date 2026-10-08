import type { NimiIntegrationCall, NimiLocalAppIntegrationClient } from '@nimiplatform/sdk/app';

function pollDelay(signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort',finish); resolve(); };
    const timer = setTimeout(finish,500); signal.addEventListener('abort',finish,{ once:true }); if(signal.aborted)finish();
  });
}

// @nimi-authority: rule.nimi.sdks.feature-clients.integrations
// Stopping this App wait suppresses subsequent body publication. Only Runtime
// assigns the call outcome. No retry or automatic business recovery lives here.
export async function runLabIntegrationCall(input: {
  client: Pick<NimiLocalAppIntegrationClient,'invoke'|'getCall'|'cancelCall'>;
  targetRef:string; operation:string; inputJson:string; signal:AbortSignal;
  accepted:(call:NimiIntegrationCall)=>Promise<void>;
  completed:(call:NimiIntegrationCall)=>Promise<void>;
  // Optional fact-only observation outlives a stopped view. It never grants
  // publication or another dispatch, and contains only actual Runtime replies.
  observed?:(call:NimiIntegrationCall)=>Promise<void>;
}): Promise<void> {
  if(input.signal.aborted)return;
  let callId='';let cancellation:Promise<unknown>|undefined;
  let observations=Promise.resolve();
  const observe=(call:NimiIntegrationCall)=>{observations=observations.then(()=>input.observed?.(call));return observations;};
  const cancel=()=>{if(callId&&!cancellation)cancellation=input.client.cancelCall({callId}).then(call=>observe(call)).catch(()=>{});};
  input.signal.addEventListener('abort',cancel,{once:true});
  try{
    let call=await input.client.invoke({targetRef:input.targetRef,operation:input.operation,inputJson:input.inputJson});callId=call.callId;
    // Queue the initial fact first, but do not let its storage I/O delay a
    // cancellation requested while invoke was still returning the call ID.
    const initialObservation=observe(call);
    if(input.signal.aborted)cancel();
    await initialObservation;
    if(input.signal.aborted){cancel();return;}
    await input.accepted(call);
    while(call.status==='accepted'&&!input.signal.aborted){
      await pollDelay(input.signal);if(input.signal.aborted)return;
      call=await input.client.getCall({callId});await observe(call);if(input.signal.aborted)return;
    }
    if(!input.signal.aborted)await input.completed(call);
  }catch(cause){cancel();throw cause;}
  finally{input.signal.removeEventListener('abort',cancel);if(cancellation)await cancellation;}
}
