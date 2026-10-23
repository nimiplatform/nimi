package runtimeagent

import (
	"context"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/aitelemetry"
)

// @nimi-authority: rule.nimi.runtime.rpc-foundations.home-ai-execution
func withLocalAgentAIObservation(ctx context.Context, localAgentRef, parentKind, parentID string, background bool) context.Context {
	if strings.TrimSpace(localAgentRef) == "" {
		return ctx
	}
	kind := "local-agent"
	if background {
		kind = "agent-background"
	}
	return aitelemetry.WithSource(ctx, aitelemetry.Source{
		Kind: kind, ID: localAgentRef, Label: "LocalAgent",
		ParentKind: parentKind, ParentID: parentID,
	})
}

func withPublicChatAIObservation(ctx context.Context, session publicChatAnchorState, turn publicChatTurnState) context.Context {
	return withLocalAgentAIObservation(ctx, session.LocalAgentRef, "agent-turn", turn.TurnID, isProactiveOrigin(turn.Origin))
}
