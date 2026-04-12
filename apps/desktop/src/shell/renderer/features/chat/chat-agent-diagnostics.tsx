import type { AgentLocalTargetSnapshot } from '@renderer/bridge/runtime-bridge/types';
import type { AgentTurnLifecycleState } from './chat-agent-shell-lifecycle';
import {
  buildAgentDiagnosticsViewModel,
  type DiagnosticsTranslate,
} from './chat-agent-diagnostics-view-model';
import {
  RuntimeInspectCard,
  RuntimeInspectUnsupportedNote,
} from './chat-runtime-inspect-content';

export function AgentDiagnosticsPanel(props: {
  activeTarget: AgentLocalTargetSnapshot | null;
  lifecycle: AgentTurnLifecycleState | null;
  routeReady: boolean;
  t: DiagnosticsTranslate;
  targetsPending: boolean;
}) {
  const viewModel = buildAgentDiagnosticsViewModel(props);
  return (
    <div className="space-y-3">
      <RuntimeInspectCard
        label={viewModel.runtimeCard.label}
        value={viewModel.runtimeCard.value}
        detail={viewModel.runtimeCard.detail || undefined}
      />
      {viewModel.emptyLabel ? (
        <RuntimeInspectUnsupportedNote label={viewModel.emptyLabel} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {viewModel.turnCards.map((card) => (
            <RuntimeInspectCard
              key={card.key}
              label={card.label}
              value={card.value}
              detail={card.detail || undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}
