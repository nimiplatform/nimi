package runtimeagent

import (
	"bytes"
	"context"
	"encoding/xml"
	"fmt"
	"io"
	"math"
	"strings"
	"unicode"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
)

const publicChatPrivateSourceRecallMaxQueryRunes = 512

type publicChatPrivateSourceRecallRequest struct {
	Query string
}

func parsePublicChatPrivateSourceRecall(raw string) (*publicChatPrivateSourceRecallRequest, bool, error) {
	trimmed := strings.TrimSpace(raw)
	if !startsWithAPMLRoot(trimmed, "message") {
		return nil, false, nil
	}
	decoder := xml.NewDecoder(strings.NewReader(trimmed))
	decoder.Strict = true
	depth := 0
	rootSeen := false
	rootClosed := false
	queryFound := false
	queryOpen := false
	invalidShape := false
	var queryText strings.Builder
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			if queryFound {
				return nil, true, fmt.Errorf("private source recall XML is invalid")
			}
			return nil, false, nil
		}
		switch item := token.(type) {
		case xml.StartElement:
			switch {
			case depth == 0:
				if rootSeen {
					invalidShape = true
				}
				rootSeen = true
				if item.Name.Space != "" || item.Name.Local != "message" || len(item.Attr) != 1 ||
					item.Attr[0].Name.Space != "" || item.Attr[0].Name.Local != "id" || item.Attr[0].Value != "message-0" {
					invalidShape = true
				}
			case depth == 1 && !rootClosed:
				if item.Name.Space == "" && item.Name.Local == "query" {
					if queryFound || len(item.Attr) != 0 {
						invalidShape = true
					}
					queryFound = true
					queryOpen = true
				} else {
					invalidShape = true
				}
			case queryOpen:
				invalidShape = true
			default:
				invalidShape = true
			}
			depth++
		case xml.CharData:
			switch {
			case queryOpen && depth == 2:
				queryText.Write([]byte(item))
			case strings.TrimSpace(string(item)) != "":
				invalidShape = true
			}
		case xml.EndElement:
			if depth <= 0 {
				invalidShape = true
				continue
			}
			if queryOpen && depth == 2 {
				if item.Name.Space != "" || item.Name.Local != "query" {
					invalidShape = true
				}
				queryOpen = false
			}
			depth--
			if depth == 0 {
				rootClosed = true
			}
		case xml.Comment, xml.Directive, xml.ProcInst:
			invalidShape = true
		}
	}
	if !queryFound {
		return nil, false, nil
	}
	if !rootSeen || !rootClosed || depth != 0 || queryOpen || invalidShape {
		return nil, true, fmt.Errorf("private source recall message wrapper is invalid")
	}
	request, err := validatePublicChatPrivateSourceRecallQuery(queryText.String())
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
	if strings.TrimSpace(input.Query) == "" || len([]rune(input.Query)) > publicChatPrivateSourceRecallMaxQueryRunes || !admittedAgentTurnCognitionSelectionStatus(input.Status) || len(input.Candidates) > 4 {
		return fmt.Errorf("agent turn private recall input is invalid")
	}
	seen := make(map[string]struct{}, len(input.Candidates))
	for _, candidate := range input.Candidates {
		if strings.TrimSpace(candidate.UnitID) == "" || strings.TrimSpace(candidate.Text) == "" || candidate.Score <= 0 {
			return fmt.Errorf("agent turn private recall candidate is invalid")
		}
		if _, duplicate := seen[candidate.UnitID]; duplicate {
			return fmt.Errorf("agent turn private recall candidate is duplicated")
		}
		seen[candidate.UnitID] = struct{}{}
	}
	return nil
}

func appendAgentTurnPrivateRecallInput(items map[agentTurnContextLaneID][]agentTurnContextItem, input *agentTurnPrivateRecallInput) error {
	if input == nil {
		return nil
	}
	ref, err := newAgentTurnContextRuntimeRefValue("privateSourceRecall", "round-1", "v1", input)
	if err != nil {
		return err
	}
	var recall bytes.Buffer
	recall.WriteString(`<message id="message-0"><query>`)
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

func (r publicChatRuntime) executePublicChatPrivateSourceRecall(ctx context.Context, session publicChatAnchorState, query string) *agentTurnPrivateRecallInput {
	result := &agentTurnPrivateRecallInput{Query: strings.TrimSpace(query), Status: "unavailable"}
	if r.svc == nil {
		return result
	}
	source, found := r.svc.turnSourceView(session.LocalAgentRef)
	if !found {
		result.Status = "failure"
		return result
	}
	retrieved := r.retrievePublicChatSourceCognition(ctx, session, source, agentTurnCurrentUserInput{Text: result.Query}, nil, nil, nil, publicChatAvailableActions{})
	result.Status = retrieved.SelectionStatus
	const recallResultBudgetBytes = 2048
	used := 0
	for _, candidate := range retrieved.Candidates {
		if len(result.Candidates) >= 4 {
			break
		}
		size := len(candidate.Category) + len(candidate.Text)
		if used+size > recallResultBudgetBytes {
			continue
		}
		result.Candidates = append(result.Candidates, candidate)
		used += size
	}
	if retrieved.CandidateCount > 0 && len(result.Candidates) == 0 {
		result.Status = "no_result"
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
func (r publicChatRuntime) executePublicChatPrivateRound(ctx context.Context, session publicChatAnchorState, turn publicChatTurnState, compilation *agentTurnContextCompilation) (*publicChatPrivateRoundResult, error) {
	if compilation == nil {
		return nil, fmt.Errorf("private recall Round 2 context is unavailable")
	}
	result := &publicChatPrivateRoundResult{ModelResolved: session.Binding.ModelID, RouteDecision: session.Binding.RoutePolicy}
	var output strings.Builder
	err := r.svc.currentPublicChatTurnExecutor().StreamChatTurn(ctx, &PublicChatTurnExecutionRequest{
		AppID: session.CallerAppID, SubjectUserID: session.SubjectUserID,
		Messages:  publicChatAgentTurnProviderMessages(compilation.ProviderPrompt.Messages),
		MaxTokens: int32(compilation.Manifest.Budget.ReservedOutputTokens), Binding: session.Binding,
		AvailableActions: turn.AvailableActions, Reasoning: clonePublicChatReasoningConfig(turn.Reasoning),
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
			if text := delta.GetText().GetText(); text != "" {
				output.WriteString(text)
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
