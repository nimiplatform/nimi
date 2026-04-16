import { Suspense, lazy } from 'react';
import type { AvatarStageRendererContext, AvatarStageRendererRegistry } from '@nimiplatform/nimi-kit/features/avatar/headless';
import { createLazyVrmAvatarRenderer } from '@nimiplatform/nimi-kit/features/avatar/vrm';
import { cn } from '@nimiplatform/nimi-kit/ui';

type ChatAgentAvatarLive2dViewportComponentProps = {
  context: AvatarStageRendererContext;
};

const LazyLive2dViewport = lazy(async () => import('./chat-agent-avatar-live2d-viewport.js').then((module) => ({
  default: function LazyChatAgentAvatarLive2dViewport({ context }: ChatAgentAvatarLive2dViewportComponentProps) {
    return <module.default input={{
      label: context.label,
      assetRef: context.snapshot.presentation.avatarAssetRef,
      posterUrl: context.renderer.posterUrl,
      idlePreset: context.snapshot.presentation.idlePreset || null,
      expressionProfileRef: context.snapshot.presentation.expressionProfileRef || null,
      interactionPolicyRef: context.snapshot.presentation.interactionPolicyRef || null,
      defaultVoiceReference: context.snapshot.presentation.defaultVoiceReference || null,
      snapshot: context.snapshot,
      style: context.style,
    }} chrome="minimal" />;
  },
})));

function renderLive2dFallback(context: AvatarStageRendererContext) {
  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.98),rgba(226,232,240,0.94)_55%,rgba(191,219,254,0.82))]">
      {context.renderer.posterUrl ? (
        <img
          src={context.renderer.posterUrl}
          alt={context.label}
          className="absolute inset-0 h-full w-full object-cover opacity-24"
        />
      ) : null}
      <span className="absolute inset-[15%] rounded-[40%] border border-white/80 bg-[radial-gradient(circle,rgba(255,255,255,0.94),rgba(224,242,254,0.46))] shadow-[0_16px_36px_rgba(15,23,42,0.08)]" />
      <span className="absolute bottom-3 rounded-full border border-white/80 bg-slate-900/84 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white">
        Live2D
      </span>
    </div>
  );
}

export const DESKTOP_AGENT_AVATAR_RENDERERS: AvatarStageRendererRegistry = {
  // Desktop opts into the admitted VRM surface explicitly and only loads the
  // desktop-local viewport module when a VRM backend is actually rendered.
  // Replacing that module with a true R3F/VRM implementation later does not
  // change chat consumers or the default avatar stage contract.
  vrm: createLazyVrmAvatarRenderer({
    loadViewport: () => import('./chat-agent-avatar-vrm-viewport.js'),
  }),
  live2d: (context) => (
    <div className={cn('relative flex h-full w-full items-center justify-center overflow-hidden')}>
      <Suspense fallback={renderLive2dFallback(context)}>
        <LazyLive2dViewport context={context} />
      </Suspense>
    </div>
  ),
};
