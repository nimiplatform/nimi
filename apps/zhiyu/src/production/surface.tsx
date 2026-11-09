import { useEffect, useState } from 'react';
import type { NimiRendererHostFacadeV1, NimiRendererHostMethodMap } from '@nimiplatform/kit/shell/renderer/host';
import { NimiToaster } from '@nimiplatform/kit/ui';
import { NimiAppChrome } from '@nimiplatform/kit/ui/app-chrome';
import { zhiyuCanonicalRendererFactory } from '../renderer/factory.js';
import { createZhiyuProductionBindings } from './renderer-bindings.js';
import { AuthGate } from '../shell/auth/auth-gate.js';
import { useZhiyuNavigationOwner } from '../shell/app/navigation.js';
import appPackage from '../../package.json';

function ZhiyuProductionSurface({ host }: { host: NimiRendererHostFacadeV1<NimiRendererHostMethodMap> }) {
  const [canonical, setCanonical] = useState<ReturnType<
    typeof zhiyuCanonicalRendererFactory.createInstance
  > | null>(null);
  useEffect(() => {
    const instance = zhiyuCanonicalRendererFactory.createInstance(
      createZhiyuProductionBindings(host),
    );
    setCanonical(instance);
    return () => instance.dispose();
  }, [host]);
  return canonical?.surfaces.main.render() ?? null;
}

export function ZhiyuFrame({ host, nativeAuth = true }: { host: NimiRendererHostFacadeV1<NimiRendererHostMethodMap>; nativeAuth?: boolean }) {
  const owner = useZhiyuNavigationOwner();
  useEffect(() => { if (nativeAuth) return; owner.setReady(true); return () => owner.setReady(false); }, [nativeAuth, owner.setReady]);
  return <div className="flex h-full min-h-0 flex-col overflow-hidden">
    <NimiAppChrome metadata={{ name: '织羽', version: appPackage.version }} locale="zh" navigation={owner.navigation} navigationEnabled={owner.ready}
      sidebar={owner.ready && owner.hasSidebar ? { visible: owner.sidebarVisible, onVisibleChange: owner.setSidebarVisible } : undefined} />
    <div className="min-h-0 flex-1 overflow-hidden">{nativeAuth ? <AuthGate><ZhiyuProductionSurface host={host} /></AuthGate> : <ZhiyuProductionSurface host={host} />}</div><NimiToaster />
  </div>;
}
