package runtimeagent

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
)

const (
	publicChatPreTurnMemoryLimit           = 8
	publicChatPreTurnDyadicContinuityLimit = 2
)

// publicChatPreTurnMemoryInput is a typed, scope-bound compiler input. Memory
// remains a separate lane; it is never rendered into a caller/system prompt by
// the continuity loader.
type publicChatPreTurnMemoryInput struct {
	CanonicalClass runtimev1.MemoryCanonicalClass
	BankScope      runtimev1.MemoryBankScope
	View           *runtimev1.CanonicalMemoryView
}

type publicChatPreTurnMemoryInputs struct {
	Items []publicChatPreTurnMemoryInput
}

func (r publicChatRuntime) loadPublicChatPreTurnMemoryInputs(
	ctx context.Context,
	session publicChatAnchorState,
	req publicChatTurnRequestPayload,
) (publicChatPreTurnMemoryInputs, error) {
	if r.svc == nil {
		return publicChatPreTurnMemoryInputs{}, nil
	}
	if strings.TrimSpace(session.SubjectUserID) == "" {
		return publicChatPreTurnMemoryInputs{}, status.Error(codes.FailedPrecondition, "public chat pre-turn memory requires subject_user_id")
	}
	requestContext := &runtimev1.AgentRequestContext{
		AppId:            strings.TrimSpace(session.CallerAppID),
		SubjectUserId:    strings.TrimSpace(session.SubjectUserID),
		OwnerUserId:      strings.TrimSpace(session.OwnerUserID),
		RuntimeSourceRef: strings.TrimSpace(session.RuntimeSourceRef),
		LocalAgentRef:    strings.TrimSpace(session.LocalAgentRef),
	}
	query := publicChatPreTurnMemoryQuery(req.Messages)
	// This is an Agent-owner composition call. It must not re-enter the public
	// protected selector seam, whose caller fields are intentionally blank and
	// Runtime-derived; the private policy runtime still validates the canonical
	// LocalAgent identity, memory class, bank and current state.
	resp, err := r.svc.memoryPolicyRuntime().query(ctx, &runtimev1.QueryAgentMemoryRequest{
		Context: requestContext,
		AgentId: strings.TrimSpace(session.AgentID),
		Query:   query,
		Limit:   publicChatPreTurnMemoryLimit,
		CanonicalClasses: []runtimev1.MemoryCanonicalClass{
			runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_PUBLIC_SHARED,
			runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_DYADIC,
		},
	})
	if err != nil {
		return publicChatPreTurnMemoryInputs{}, err
	}
	primary, err := publicChatPreTurnMemoryInputsFromResponse(session, resp)
	if err != nil || strings.TrimSpace(query) == "" {
		return primary, err
	}
	recentDyadicResp, err := r.svc.memoryPolicyRuntime().query(ctx, &runtimev1.QueryAgentMemoryRequest{
		Context:          requestContext,
		AgentId:          strings.TrimSpace(session.AgentID),
		Limit:            publicChatPreTurnDyadicContinuityLimit,
		CanonicalClasses: []runtimev1.MemoryCanonicalClass{runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_DYADIC},
	})
	if err != nil {
		return publicChatPreTurnMemoryInputs{}, err
	}
	recentDyadic, err := publicChatPreTurnMemoryInputsFromResponse(session, recentDyadicResp)
	if err != nil {
		return publicChatPreTurnMemoryInputs{}, err
	}
	return mergePublicChatPreTurnMemoryInputs(primary, recentDyadic)
}

func mergePublicChatPreTurnMemoryInputs(
	primary publicChatPreTurnMemoryInputs,
	recentDyadic publicChatPreTurnMemoryInputs,
) (publicChatPreTurnMemoryInputs, error) {
	merged := publicChatPreTurnMemoryInputs{Items: make([]publicChatPreTurnMemoryInput, 0, publicChatPreTurnMemoryLimit)}
	seen := make(map[string]*runtimev1.CanonicalMemoryView)
	appendInput := func(input publicChatPreTurnMemoryInput) error {
		memoryID := strings.TrimSpace(input.View.GetRecord().GetMemoryId())
		if memoryID == "" {
			return status.Error(codes.DataLoss, "canonical memory continuity input has no memory id")
		}
		if existing, ok := seen[memoryID]; ok {
			if existing.GetCanonicalClass() != input.View.GetCanonicalClass() ||
				!proto.Equal(existing.GetSourceBank(), input.View.GetSourceBank()) ||
				!proto.Equal(existing.GetRecord(), input.View.GetRecord()) {
				return status.Error(codes.DataLoss, "canonical memory continuity input conflicts with query recall")
			}
			return nil
		}
		if len(merged.Items) >= publicChatPreTurnMemoryLimit {
			return nil
		}
		seen[memoryID] = input.View
		merged.Items = append(merged.Items, input)
		return nil
	}
	for index, input := range recentDyadic.Items {
		if index >= publicChatPreTurnDyadicContinuityLimit {
			break
		}
		if input.CanonicalClass != runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_DYADIC ||
			input.BankScope != runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_DYADIC {
			return publicChatPreTurnMemoryInputs{}, status.Error(codes.DataLoss, "canonical memory continuity input is not dyadic")
		}
		if err := appendInput(input); err != nil {
			return publicChatPreTurnMemoryInputs{}, err
		}
	}
	for _, input := range primary.Items {
		if err := appendInput(input); err != nil {
			return publicChatPreTurnMemoryInputs{}, err
		}
	}
	return merged, nil
}

func publicChatPreTurnMemoryInputsFromResponse(session publicChatAnchorState, resp *runtimev1.QueryAgentMemoryResponse) (publicChatPreTurnMemoryInputs, error) {
	inputs := publicChatPreTurnMemoryInputs{Items: make([]publicChatPreTurnMemoryInput, 0, len(resp.GetMemories()))}
	for _, view := range resp.GetMemories() {
		if view == nil || view.GetRecord() == nil || view.GetSourceBank() == nil {
			return publicChatPreTurnMemoryInputs{}, status.Error(codes.DataLoss, "canonical memory input is incomplete")
		}
		class := view.GetCanonicalClass()
		scope := view.GetSourceBank().GetScope()
		switch class {
		case runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_PUBLIC_SHARED:
			owner := view.GetSourceBank().GetAgentCore()
			if scope != runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE || owner == nil || strings.TrimSpace(owner.GetAgentId()) != strings.TrimSpace(session.LocalAgentRef) {
				return publicChatPreTurnMemoryInputs{}, status.Error(codes.DataLoss, "public shared memory is not bound to the local agent core")
			}
		case runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_DYADIC:
			owner := view.GetSourceBank().GetAgentDyadic()
			if scope != runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_DYADIC || owner == nil ||
				strings.TrimSpace(owner.GetAgentId()) != strings.TrimSpace(session.LocalAgentRef) ||
				strings.TrimSpace(owner.GetUserId()) != strings.TrimSpace(session.SubjectUserID) {
				return publicChatPreTurnMemoryInputs{}, status.Error(codes.DataLoss, "dyadic memory is not bound to the local agent and subject")
			}
		default:
			return publicChatPreTurnMemoryInputs{}, status.Error(codes.DataLoss, "canonical memory returned an unrequested class")
		}
		inputs.Items = append(inputs.Items, publicChatPreTurnMemoryInput{
			CanonicalClass: class,
			BankScope:      scope,
			View:           proto.Clone(view).(*runtimev1.CanonicalMemoryView),
		})
	}
	return inputs, nil
}

func publicChatPreTurnMemoryQuery(messages []publicChatMessagePayload) string {
	parts := make([]string, 0, len(messages))
	for _, message := range messages {
		role := strings.TrimSpace(message.Role)
		if role != "user" && role != publicChatInternalFollowUpInstructionRole {
			continue
		}
		if content := strings.TrimSpace(message.Content); content != "" {
			parts = append(parts, content)
		}
	}
	return strings.Join(parts, "\n")
}
