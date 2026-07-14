package runtimeagent

import (
	"context"
	"fmt"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

type DevKernelCheckpointSeed struct {
	OwnerUserID      string
	LocalAgentRef    string
	RuntimeSourceRef string
	DisplayName      string
}

// EnsureDevKernelCheckpointSeed materializes one account-owned RuntimeAgent
// inside the already isolated non-release service root. It creates no app
// principal, grant, launch, session, or conversation anchor and therefore
// cannot bypass the local-app kernel. The same input is idempotent across a
// fixed Runtime service restart.
func (s *Service) EnsureDevKernelCheckpointSeed(ctx context.Context, seed DevKernelCheckpointSeed) (*runtimev1.AgentRecord, error) {
	values := []string{seed.OwnerUserID, seed.LocalAgentRef, seed.RuntimeSourceRef, seed.DisplayName}
	for _, value := range values {
		if value == "" || strings.TrimSpace(value) != value {
			return nil, fmt.Errorf("dev-kernel RuntimeAgent seed is invalid")
		}
	}
	response, err := s.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		Context: &runtimev1.AgentRequestContext{
			AppId:            "runtime",
			SubjectUserId:    seed.OwnerUserID,
			OwnerUserId:      seed.OwnerUserID,
			RuntimeSourceRef: seed.RuntimeSourceRef,
			LocalAgentRef:    seed.LocalAgentRef,
		},
		LocalAgentRef:    seed.LocalAgentRef,
		OwnerUserId:      seed.OwnerUserID,
		RuntimeSourceRef: seed.RuntimeSourceRef,
		DisplayName:      seed.DisplayName,
	})
	if err != nil {
		return nil, err
	}
	agent := response.GetAgent()
	if agent == nil || agent.GetOwnerUserId() != seed.OwnerUserID ||
		agent.GetLocalAgentRef() != seed.LocalAgentRef ||
		agent.GetRuntimeSourceRef() != seed.RuntimeSourceRef ||
		agent.GetDisplayName() != seed.DisplayName {
		return nil, fmt.Errorf("dev-kernel RuntimeAgent seed identity mismatch")
	}
	return cloneAgentRecord(agent), nil
}
