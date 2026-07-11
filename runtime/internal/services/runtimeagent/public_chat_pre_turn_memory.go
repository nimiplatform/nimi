package runtimeagent

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
)

const publicChatPreTurnMemoryLimit = 8

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
	resp, err := r.svc.QueryAgentMemory(ctx, &runtimev1.QueryAgentMemoryRequest{
		Context: &runtimev1.AgentRequestContext{
			AppId:            strings.TrimSpace(session.CallerAppID),
			SubjectUserId:    strings.TrimSpace(session.SubjectUserID),
			OwnerUserId:      strings.TrimSpace(session.OwnerUserID),
			RuntimeSourceRef: strings.TrimSpace(session.RuntimeSourceRef),
			LocalAgentRef:    strings.TrimSpace(session.LocalAgentRef),
		},
		AgentId: strings.TrimSpace(session.AgentID),
		Query:   publicChatPreTurnMemoryQuery(req.Messages),
		Limit:   publicChatPreTurnMemoryLimit,
		CanonicalClasses: []runtimev1.MemoryCanonicalClass{
			runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_PUBLIC_SHARED,
			runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_DYADIC,
		},
	})
	if err != nil {
		return publicChatPreTurnMemoryInputs{}, err
	}

	return publicChatPreTurnMemoryInputsFromResponse(session, resp)
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
