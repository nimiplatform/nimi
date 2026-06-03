import { AdvBlock } from './chat-agent-center-panel';
import { AgentDiagnosticsPanel } from './chat-agent-diagnostics';
import type { UseAgentConversationPresentationInput } from './chat-agent-shell-presentation-types';

export function AgentConversationDiagnosticsContent({
  input,
}: {
  input: UseAgentConversationPresentationInput;
}) {
  return (
    <AgentDiagnosticsPanel
      activeTarget={input.activeTarget}
      lifecycle={input.currentFooterHostState?.lifecycle || null}
      mutationPendingAction={input.mutationPendingAction}
      onCancelHook={input.onCancelPendingHook}
      onClearDyadicContext={input.onClearDyadicContext}
      onClearWorldContext={input.onClearWorldContext}
      onDisableAutonomy={input.onDisableAutonomy}
      onEnableAutonomy={input.onEnableAutonomy}
      onRefreshInspect={input.onRefreshInspect}
      onUpdateRuntimeState={input.onUpdateRuntimeState}
      onUpdateAutonomyConfig={input.onUpdateAutonomyConfig}
      recentRuntimeEvents={input.recentRuntimeEvents}
      routeReady={input.routeReady}
      runtimeInspect={input.runtimeInspect}
      runtimeInspectLoading={input.runtimeInspectLoading}
      t={input.t}
      targetsPending={input.targetsPending}
      renderShell={(sections) => (
        <div>
          {sections.map((section, index) => (
            <AdvBlock
              key={section.id}
              title={section.title}
              defaultOpen={index === 0}
              dirty={section.dirty}
              headerAction={section.headerAction}
            >
              {section.body}
            </AdvBlock>
          ))}
        </div>
      )}
    />
  );
}
