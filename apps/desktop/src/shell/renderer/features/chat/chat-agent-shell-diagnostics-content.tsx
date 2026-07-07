import type { ReactNode } from 'react';
import { ChatAgentDiagnosticsPanel } from './chat-agent-diagnostics';
import type { UseAgentConversationPresentationInput } from './chat-agent-shell-presentation-types';

function DiagnosticsBlock(props: {
  title: string;
  defaultOpen?: boolean;
  dirty?: boolean;
  headerAction?: ReactNode;
  children: ReactNode;
}) {
  return (
    <details
      className="rounded-lg border border-slate-200 bg-white p-3"
      open={props.defaultOpen}
    >
      <summary className="flex cursor-pointer items-center justify-between gap-3 text-sm font-semibold text-slate-900">
        <span>{props.title}{props.dirty ? ' *' : ''}</span>
        {props.headerAction}
      </summary>
      <div className="mt-3">{props.children}</div>
    </details>
  );
}

export function ChatAgentDiagnosticsContent({
  input,
}: {
  input: UseAgentConversationPresentationInput;
}) {
  return (
    <ChatAgentDiagnosticsPanel
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
            <DiagnosticsBlock
              key={section.id}
              title={section.title}
              defaultOpen={index === 0}
              dirty={section.dirty}
              headerAction={section.headerAction}
            >
              {section.body}
            </DiagnosticsBlock>
          ))}
        </div>
      )}
    />
  );
}
