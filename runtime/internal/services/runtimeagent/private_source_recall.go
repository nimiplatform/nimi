package runtimeagent

import (
	"bytes"
	"context"
	"encoding/xml"
	"fmt"
	"math"
	"strings"
	"time"
	"unicode"

	"github.com/nimiplatform/nimi/nimi-cognition/memoryv1"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/services/cognitionmemory"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
)

const publicChatPrivateSourceRecallMaxQueryRunes = 512

// Optional Memory index work; source Cognition separately budgets index reads
// around its captured embedding Job. Neither budget is a model-load timeout.
const publicChatOptionalContextBudget = 750 * time.Millisecond

type publicChatPrivateSourceRecallRequest struct {
	Query string
}

// @nimi-authority: rule.nimi.runtime.agent-participation.r012
func parsePublicChatPrivateSourceRecall(raw string) (*publicChatPrivateSourceRecallRequest, bool, error) {
	result := interpretPublicChatAPML(raw)
	if result.ResponseKind == "recall" && !result.QuerySeen {
		return nil, true, fmt.Errorf("recall intent requires one query")
	}
	if !result.QuerySeen {
		return nil, false, nil
	}
	if result.Err != nil {
		return nil, true, fmt.Errorf("private source recall message is invalid: %w", result.Err)
	}
	request, err := validatePublicChatPrivateSourceRecallQuery(result.Query)
	return request, true, err
}

func validatePublicChatPrivateSourceRecallQuery(value string) (*publicChatPrivateSourceRecallRequest, error) {
	query := strings.TrimSpace(value)
	if query == "" || len([]rune(query)) > publicChatPrivateSourceRecallMaxQueryRunes {
		return nil, fmt.Errorf("private source recall query is invalid")
	}
	for _, char := range query {
		if unicode.IsControl(char) && char != '\n' && char != '\t' {
			return nil, fmt.Errorf("private source recall query contains control characters")
		}
	}
	return &publicChatPrivateSourceRecallRequest{Query: query}, nil
}

func validateAgentTurnPrivateRecallInput(input *agentTurnPrivateRecallInput) error {
	if input == nil {
		return nil
	}
	if strings.TrimSpace(input.Query) == "" || len([]rune(input.Query)) > publicChatPrivateSourceRecallMaxQueryRunes || !admittedAgentTurnCognitionSelectionStatus(input.Status) || len(input.Candidates)+len(input.Memory) > 4 {
		return fmt.Errorf("agent turn private recall input is invalid")
	}
	seen := make(map[string]struct{}, len(input.Candidates))
	for _, candidate := range input.Candidates {
		if strings.TrimSpace(candidate.UnitID) == "" || strings.TrimSpace(candidate.Text) == "" || !validAgentTurnCognitionSelection(candidate) {
			return fmt.Errorf("agent turn private recall candidate is invalid")
		}
		if _, duplicate := seen[candidate.UnitID]; duplicate {
			return fmt.Errorf("agent turn private recall candidate is duplicated")
		}
		seen[candidate.UnitID] = struct{}{}
	}
	return validateAgentTurnMemoryInputs(input.Memory)
}

func normalizeAgentTurnPrivateRecallMemory(base []agentTurnMemoryInput, input *agentTurnPrivateRecallInput) (*agentTurnPrivateRecallInput, error) {
	if input == nil || len(input.Memory) == 0 || len(base) == 0 {
		return input, nil
	}
	known := make(map[string]agentTurnMemoryInput, len(base))
	for _, memory := range base {
		known[memory.MemoryID] = memory
	}
	out := *input
	out.Candidates = append([]agentTurnCognitionCandidateInput(nil), input.Candidates...)
	out.Memory = make([]agentTurnMemoryInput, 0, len(input.Memory))
	for _, memory := range input.Memory {
		if existing, duplicate := known[memory.MemoryID]; duplicate {
			if existing.Scope != memory.Scope || existing.ProvenanceRef != memory.ProvenanceRef || existing.Text != memory.Text {
				return nil, fmt.Errorf("private recalled Memory conflicts with an already selected canonical Memory item")
			}
			continue
		}
		out.Memory = append(out.Memory, memory)
	}
	return &out, nil
}

func appendAgentTurnPrivateRecallInput(items map[agentTurnContextLaneID][]agentTurnContextItem, input *agentTurnPrivateRecallInput) error {
	if input == nil {
		return nil
	}
	if err := appendAgentTurnMemoryItems(items, input.Memory); err != nil {
		return err
	}
	ref, err := newAgentTurnContextRuntimeRefValue("privateSourceRecall", "round-1", "v1", input)
	if err != nil {
		return err
	}
	var recall bytes.Buffer
	recall.WriteString(`<message intent="recall" id="message-0"><query>`)
	if err := xml.EscapeText(&recall, []byte(input.Query)); err != nil {
		return err
	}
	recall.WriteString("</query></message>")
	fields := []agentTurnContextTextField{
		{Name: "request_apml", Values: []string{recall.String()}},
		{Name: "status", Values: []string{input.Status}},
	}
	for _, candidate := range input.Candidates {
		fields = append(fields, agentTurnContextTextField{Name: "source_candidate", Values: []string{candidate.Category + ": " + candidate.Text}})
	}
	fields = append(fields, agentTurnContextTextField{Name: "round_2_contract", Values: []string{"Return the final APML message now. A second recall is forbidden."}})
	exchange := agentTurnContextTypedContent("Runtime-private source recall exchange", fields...)
	item, err := newAgentTurnContextItem(
		agentTurnContextLanePrivateRecall, "runtime.private-recall.round-1", "runtime.privateRecall.round1", ref,
		agentTurnContextAuthorityPrivateRecall, agentTurnContextTrustValidatedSource, 1000, 1, true,
		agentTurnContextTruncationNone,
		[]agentTurnContextSegment{{Role: "system", Content: exchange}}, nil,
	)
	if err != nil {
		return err
	}
	items[agentTurnContextLanePrivateRecall] = append(items[agentTurnContextLanePrivateRecall], item)
	return nil
}

func agentTurnPrivateRecallCount(input *agentTurnPrivateRecallInput) uint32 {
	if input == nil {
		return 0
	}
	return 1
}

func agentTurnPrivateRecallMemoryCount(input *agentTurnPrivateRecallInput) int {
	if input == nil {
		return 0
	}
	return len(input.Memory)
}

func (r publicChatRuntime) executePublicChatPrivateSourceRecall(ctx context.Context, session publicChatAnchorState, query string) *agentTurnPrivateRecallInput {
	result := &agentTurnPrivateRecallInput{Query: strings.TrimSpace(query), Status: "unavailable"}
	if r.svc == nil {
		return result
	}
	source, found := r.svc.turnSourceView(session.LocalAgentRef)
	retrieved := agentTurnCognitionInput{AdapterStatus: "unavailable", SelectionStatus: "unavailable"}
	if found {
		retrieved = r.retrievePublicChatSourceCognition(ctx, session, source, agentTurnCurrentUserInput{Text: result.Query}, nil, nil, nil, publicChatAvailableActions{})
	}
	result.Status = retrieved.SelectionStatus
	const recallResultBudgetBytes = 2048
	used := 0
	appendCandidate := func(candidate agentTurnCognitionCandidateInput) {
		if len(result.Candidates)+len(result.Memory) >= 4 {
			return
		}
		size := len(candidate.Category) + len(candidate.Text)
		if used+size > recallResultBudgetBytes {
			return
		}
		result.Candidates = append(result.Candidates, candidate)
		used += size
	}
	appendMemory := func(memory agentTurnMemoryInput) {
		if len(result.Candidates)+len(result.Memory) >= 4 {
			return
		}
		size := len(memory.Text)
		if used+size > recallResultBudgetBytes {
			return
		}
		result.Memory = append(result.Memory, memory)
		used += size
	}
	initialSourceCount := min(2, len(retrieved.Candidates))
	for _, candidate := range retrieved.Candidates[:initialSourceCount] {
		appendCandidate(candidate)
	}
	memoryStatus := "unavailable"
	if r.svc.cognitionMemoryFacade != nil {
		memoryCtx, cancelMemory := context.WithTimeout(ctx, publicChatOptionalContextBudget)
		memoryResult, err := r.svc.cognitionMemoryFacade.Recall(memoryCtx, cognitionmemory.RecallIntent{NoModelWork: true, LocalAgentRef: session.LocalAgentRef, Query: result.Query, Limit: 4})
		cancelMemory()
		if err == nil {
			memoryStatus = string(memoryResult.Outcome)
			if memoryResult.Outcome == memoryv1.OutcomeReady {
				result.MemoryReadSet = memoryResult.ReadSet
				memories, mapErr := publicChatCognitionMemoryInputs(memoryResult.Hits)
				if mapErr != nil {
					memoryStatus = string(memoryv1.OutcomeFailed)
					if r.svc.logger != nil {
						r.svc.logger.Warn("optional Cognition Memory private recall projection invalid", "local_agent_ref", session.LocalAgentRef, "error", mapErr)
					}
				} else {
					for _, memory := range memories {
						appendMemory(memory)
					}
				}
			}
		} else if r.svc.logger != nil {
			r.svc.logger.Warn("optional Cognition Memory private recall unavailable", "local_agent_ref", session.LocalAgentRef, "outcome", memoryResult.Outcome, "error", err)
		}
	}
	for _, candidate := range retrieved.Candidates[initialSourceCount:] {
		appendCandidate(candidate)
	}
	if len(result.Candidates)+len(result.Memory) > 0 {
		result.Status = "ready"
	} else if retrieved.CandidateCount > 0 {
		result.Status = "no_result"
	} else if retrieved.SelectionStatus == "no_hits" && memoryStatus == string(memoryv1.OutcomeNoHits) {
		result.Status = "no_hits"
	} else if retrieved.SelectionStatus == "failure" && memoryStatus == string(memoryv1.OutcomeFailed) {
		result.Status = "failure"
	} else if retrieved.SelectionStatus == "unconfigured" && memoryStatus == string(memoryv1.OutcomeUnconfigured) {
		result.Status = "unconfigured"
	}
	return result
}

type publicChatPrivateRoundResult struct {
	RawOutput     string
	Usage         *runtimev1.UsageStats
	Finish        *runtimev1.ScenarioStreamCompleted
	Failed        *runtimev1.ScenarioStreamFailed
	TraceID       string
	ModelResolved string
	RouteDecision runtimev1.RoutePolicy
}

// @nimi-authority: rule.nimi.runtime.agent-service.r061
// @nimi-authority: rule.nimi.runtime.agent-participation.r189
func (r publicChatRuntime) executePublicChatPrivateRound(ctx context.Context, session publicChatAnchorState, turn publicChatTurnState, compilation *agentTurnContextCompilation, callerMaxTokens int32, publish func(string) error) (*publicChatPrivateRoundResult, error) {
	if compilation == nil {
		return nil, fmt.Errorf("private recall Round 2 context is unavailable")
	}
	result := &publicChatPrivateRoundResult{ModelResolved: session.Binding.ModelID, RouteDecision: session.Binding.RoutePolicy}
	var responseFormat *runtimev1.ResponseFormat

	var output strings.Builder
	projected := ""
	err := r.svc.currentPublicChatTurnExecutor().StreamChatTurn(ctx, &PublicChatTurnExecutionRequest{
		AppID: session.CallerAppID, SubjectUserID: session.SubjectUserID,
		Messages:             publicChatAgentTurnProviderMessages(compilation.ProviderPrompt.Messages),
		MaxTokens:            callerMaxTokens,
		ReservedOutputTokens: int32(compilation.Manifest.Budget.ReservedOutputTokens),
		Binding:              session.Binding,
		ResponseFormat:       responseFormat,
		AvailableActions:     turn.AvailableActions, Reasoning: clonePublicChatReasoningConfig(turn.Reasoning),
	}, func(event *runtimev1.StreamScenarioEvent) error {
		if event == nil {
			return nil
		}
		if traceID := strings.TrimSpace(event.GetTraceId()); traceID != "" {
			result.TraceID = traceID
		}
		if started := event.GetStarted(); started != nil {
			result.ModelResolved = strings.TrimSpace(started.GetModelResolved())
			result.RouteDecision = started.GetRouteDecision()
		}
		if delta := event.GetDelta(); delta != nil {
			if text := scenarioStreamText(event); text != "" {
				output.WriteString(text)
				visible, valid := publicChatStreamingMessageText(output.String())
				if valid && strings.HasPrefix(visible, projected) && len(visible) > len(projected) {
					if publish != nil {
						if err := publish(visible[len(projected):]); err != nil {
							return err
						}
					}
					projected = visible
				}
			}
		}
		if event.GetUsage() != nil {
			result.Usage = proto.Clone(event.GetUsage()).(*runtimev1.UsageStats)
		}
		if event.GetCompleted() != nil {
			result.Finish = proto.Clone(event.GetCompleted()).(*runtimev1.ScenarioStreamCompleted)
			if result.Finish.GetUsage() != nil {
				result.Usage = proto.Clone(result.Finish.GetUsage()).(*runtimev1.UsageStats)
			}
		}
		if event.GetFailed() != nil {
			result.Failed = proto.Clone(event.GetFailed()).(*runtimev1.ScenarioStreamFailed)
		}
		return nil
	})
	result.RawOutput = output.String()
	if err != nil {
		return result, err
	}
	if result.Failed != nil {
		return result, grpcerr.WithReasonCodeOptions(
			codes.Internal,
			result.Failed.GetReasonCode(),
			grpcerr.ReasonOptions{
				ActionHint: strings.TrimSpace(result.Failed.GetActionHint()),
				TraceID:    strings.TrimSpace(result.TraceID),
				Message:    "runtime private recall Round 2 failed",
			},
		)
	}
	if result.Finish == nil {
		return result, grpcerr.WithReasonCodeOptions(
			codes.Internal,
			runtimev1.ReasonCode_AI_STREAM_BROKEN,
			grpcerr.ReasonOptions{TraceID: strings.TrimSpace(result.TraceID), Message: "runtime private recall Round 2 ended without completion"},
		)
	}
	if _, repeated, err := parsePublicChatPrivateSourceRecall(output.String()); repeated {
		if err != nil {
			return result, grpcerr.WrapWithReasonCode(
				codes.Internal,
				runtimev1.ReasonCode_AI_OUTPUT_INVALID,
				err,
				grpcerr.ReasonOptions{TraceID: strings.TrimSpace(result.TraceID), Message: "runtime private recall Round 2 output is invalid"},
			)
		}
		return result, grpcerr.WithReasonCodeOptions(
			codes.Internal,
			runtimev1.ReasonCode_AI_OUTPUT_INVALID,
			grpcerr.ReasonOptions{TraceID: strings.TrimSpace(result.TraceID), Message: "private source recall cannot repeat in Round 2"},
		)
	}
	return result, nil
}

func aggregatePublicChatPrivateRoundUsage(roundOne *runtimev1.UsageStats, roundTwo *runtimev1.UsageStats) *runtimev1.UsageStats {
	if roundOne == nil && roundTwo == nil {
		return nil
	}
	return &runtimev1.UsageStats{
		InputTokens:           addNonNegativeUsage(roundOne.GetInputTokens(), roundTwo.GetInputTokens()),
		OutputTokens:          addNonNegativeUsage(roundOne.GetOutputTokens(), roundTwo.GetOutputTokens()),
		ComputeMs:             addNonNegativeUsage(roundOne.GetComputeMs(), roundTwo.GetComputeMs()),
		CachedInputTokens:     addNonNegativeUsage(roundOne.GetCachedInputTokens(), roundTwo.GetCachedInputTokens()),
		ReasoningOutputTokens: addNonNegativeUsage(roundOne.GetReasoningOutputTokens(), roundTwo.GetReasoningOutputTokens()),
	}
}

func addNonNegativeUsage(left int64, right int64) int64 {
	if left < 0 {
		left = 0
	}
	if right < 0 {
		right = 0
	}
	if right > math.MaxInt64-left {
		return math.MaxInt64
	}
	return left + right
}
