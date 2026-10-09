// Ephemeral App-owned coordination, shared by views of the same renderer scope.
// It only guards history mutations; it grants no Runtime permission and stores
// no bodies or durable tombstones. Issued writes keep their hold across unmount.
const scopes=new WeakMap<object,ReturnType<typeof createHistoryWork>>();
function createHistoryWork(){
  const holds=new Map<string,Set<symbol>>();const listeners=new Set<()=>void>();
  const notify=()=>{for(const listener of listeners)listener();};
  return {
    ids:()=>[...holds.keys()],busy:(id:string)=>holds.has(id),
    hold(id:string){const token=Symbol();const owners=holds.get(id)||new Set<symbol>();owners.add(token);holds.set(id,owners);notify();return()=>{if(holds.get(id)!==owners||!owners.delete(token))return;if(!owners.size)holds.delete(id);notify();};},
    subscribe(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};},
    invalidate(){holds.clear();notify();},
  };
}
export function integrationHistoryWork(scope:object){let work=scopes.get(scope);if(!work){work=createHistoryWork();scopes.set(scope,work);}return work;}
