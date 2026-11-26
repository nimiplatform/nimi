import type { NimiAppRuntimeClient } from '@nimiplatform/sdk/app';
import { useEffect, useState, type ReactNode } from 'react';
import type { NimiRendererHostFacadeV1, NimiRendererHostMethodMap } from '@nimiplatform/kit/shell/renderer/host';
import { NimiToaster } from '@nimiplatform/kit/ui';
import { NimiAppChrome } from '@nimiplatform/kit/ui/app-chrome';
import type { NimiAppCommand } from '@nimiplatform/kit/core/app-commands';
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

export function ZhiyuFrame({
  host,
  client,
  commands,
  appName = '织羽',
  chromeTrailing,
  children,
}: {
  client: NimiAppRuntimeClient;
  host: NimiRendererHostFacadeV1<NimiRendererHostMethodMap>;
  commands?: readonly NimiAppCommand[];
  appName?: string;
  chromeTrailing?: ReactNode;
  children?: ReactNode;
}) {
  const owner = useZhiyuNavigationOwner();
  useEffect(() => { owner.setReady(true); return () => owner.setReady(false); }, [owner.setReady]);
  const chrome = (
    <NimiAppChrome
      metadata={{ name: appName, version: appPackage.version }}
      locale="zh"
      commands={commands}
      navigation={owner.navigation}
      navigationEnabled={owner.ready}
      sidebar={owner.ready && owner.hasSidebar ? { visible: owner.sidebarVisible, onVisibleChange: owner.setSidebarVisible } : undefined}
    />
  );
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--nimi-app-background)] text-[var(--nimi-text-primary)]">
      {chromeTrailing ? (
        <div className="zhiyu-top-chrome" data-zhiyu-unified-chrome="true">
          {chrome}
          <div className="zhiyu-top-chrome__trailing">{chromeTrailing}</div>
        </div>
      ) : chrome}
      <div className="min-h-0 flex-1 overflow-hidden">
        {children ?? <ZhiyuProductionSurface host={host} client={client} />}
      </div>
      <NimiToaster dismissLabel="关闭" />
    </div>
  );
}
