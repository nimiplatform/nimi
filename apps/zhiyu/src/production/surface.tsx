import type { NimiAppRuntimeClient } from '@nimiplatform/sdk/app';
import { useEffect, useState } from 'react';
import type { NimiRendererHostFacadeV1, NimiRendererHostMethodMap } from '@nimiplatform/kit/shell/renderer/host';
import { NimiToaster } from '@nimiplatform/kit/ui';
import { NimiAppChrome } from '@nimiplatform/kit/ui/app-chrome';
import { zhiyuCanonicalRendererFactory } from '../renderer/factory.js';
import { createZhiyuProductionBindings } from './renderer-bindings.js';
import { useZhiyuNavigationOwner } from '../shell/app/navigation.js';
import appPackage from '../../package.json';

function ZhiyuProductionSurface({ host, client }: { host: NimiRendererHostFacadeV1<NimiRendererHostMethodMap>; client?: NimiAppRuntimeClient }) {
  const [canonical, setCanonical] = useState<ReturnType<
    typeof zhiyuCanonicalRendererFactory.createInstance
  > | null>(null);
  useEffect(() => {
    const instance = zhiyuCanonicalRendererFactory.createInstance(
      createZhiyuProductionBindings(host, { client }),
    );
    setCanonical(instance);
    return () => instance.dispose();
  }, [host, client]);
  return canonical?.surfaces.main.render() ?? null;
}

export function ZhiyuFrame({ host, client }: { client: NimiAppRuntimeClient; host: NimiRendererHostFacadeV1<NimiRendererHostMethodMap> }) {
  const owner = useZhiyuNavigationOwner();
  useEffect(() => { owner.setReady(true); return () => owner.setReady(false); }, [owner.setReady]);
  return <div className="flex h-full min-h-0 flex-col overflow-hidden">
    <NimiAppChrome metadata={{ name: '织羽', version: appPackage.version }} locale="zh" navigation={owner.navigation} navigationEnabled={owner.ready}
      sidebar={owner.ready && owner.hasSidebar ? { visible: owner.sidebarVisible, onVisibleChange: owner.setSidebarVisible } : undefined} />
    <div className="min-h-0 flex-1 overflow-hidden"><ZhiyuProductionSurface host={host} client={client} /></div><NimiToaster />
  </div>;
}
