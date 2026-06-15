package runtimeagent

import (
	"context"
	"fmt"
	"io"
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
)

func (rejectingPublicChatTurnExecutor) StreamChatTurn(context.Context, *PublicChatTurnExecutionRequest, func(*runtimev1.StreamScenarioEvent) error) error {
	return fmt.Errorf("runtime public chat turn executor unavailable or not admitted")
}
func IsPublicChatIngressMessageType(messageType string) bool {
	switch strings.TrimSpace(messageType) {
	case publicChatTurnRequestType, publicChatTurnInterruptType:
		return true
	default:
		return false
	}
}
func NewAIBackedPublicChatTurnExecutor(ai publicChatScenarioStreamer) PublicChatTurnExecutor {
	if ai == nil {
		return rejectingPublicChatTurnExecutor{}
	}
	return &aiBackedPublicChatTurnExecutor{ai: ai}
}

const publicChatAPMLOutputContractPromptTemplate = `Runtime output contract:
- Return APML only. The first non-whitespace characters must be <message id="message-0">.
- Do not output Markdown, JSON, code fences, prose before APML, or <think> reasoning tags.
- Required shape: <message id="message-0">assistant-visible reply text</message>.
- Optional message cues are child elements inside <message>, at most one each: <emotion>%s</emotion> and <activity>%s</activity>.
- Optional image/voice action after message: <action id="action-0" kind="image"><prompt-payload kind="image"><prompt-text>generation prompt</prompt-text></prompt-payload></action> or kind="voice".
- If the user asks to create, draw, generate, send, or show an image, photo, picture, avatar, selfie, or visual, include exactly one sibling <action kind="image"> after the message.
- For an agent photo/avatar/selfie request, do not answer that you lack a physical body as a reason to skip the action; create a representative or stylized visual prompt for the agent instead.
- Optional follow-up hook after message: <time-hook id="hook-0"><delay-ms>600000</delay-ms><effect kind="follow-up-turn"><prompt-text>follow-up instruction</prompt-text></effect></time-hook>.
- Top-level tags are limited to the first <message>, then optional sibling <action>, <time-hook>, or <event-hook>.
- Every opened tag must close.`

func publicChatAPMLOutputContractPrompt() string {
	return fmt.Sprintf(
		publicChatAPMLOutputContractPromptTemplate,
		strings.Join(publicChatSortedSetKeys(admittedCurrentEmotions), "|"),
		strings.Join(publicChatSortedStringMapKeys(admittedActivityCategories), "|"),
	)
}

func publicChatSystemPromptWithAPMLOutputContract(base string) string {
	trimmed := strings.TrimSpace(base)
	contract := publicChatAPMLOutputContractPrompt()
	if trimmed == "" {
		return contract
	}
	return trimmed + "\n\n" + contract
}

func publicChatSortedSetKeys(values map[string]struct{}) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func publicChatSortedStringMapKeys(values map[string]string) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func (s *publicChatScenarioStreamServer) SetHeader(metadata.MD) error  { return nil }
func (s *publicChatScenarioStreamServer) SendHeader(metadata.MD) error { return nil }
func (s *publicChatScenarioStreamServer) SetTrailer(metadata.MD)       {}
func (s *publicChatScenarioStreamServer) Context() context.Context {
	if s == nil || s.ctx == nil {
		return context.Background()
	}
	return s.ctx
}
func (s *publicChatScenarioStreamServer) SendMsg(message any) error {
	event, ok := message.(*runtimev1.StreamScenarioEvent)
	if !ok {
		return status.Error(codes.Internal, "public chat scenario stream message type invalid")
	}
	return s.Send(event)
}
func (s *publicChatScenarioStreamServer) RecvMsg(any) error {
	return io.EOF
}
func (s *publicChatScenarioStreamServer) Send(event *runtimev1.StreamScenarioEvent) error {
	if s == nil || s.send == nil || event == nil {
		return nil
	}
	return s.send(proto.Clone(event).(*runtimev1.StreamScenarioEvent))
}
func (e *aiBackedPublicChatTurnExecutor) StreamChatTurn(
	ctx context.Context,
	req *PublicChatTurnExecutionRequest,
	emit func(*runtimev1.StreamScenarioEvent) error,
) error {
	if e == nil || e.ai == nil {
		return fmt.Errorf("runtime public chat turn executor unavailable or not admitted")
	}
	if req == nil {
		return status.Error(codes.InvalidArgument, "public chat turn request is required")
	}
	streamReq := &runtimev1.StreamScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         firstNonEmpty(strings.TrimSpace(req.AppID), publicChatRuntimeAppID),
			SubjectUserId: strings.TrimSpace(req.SubjectUserID),
			ModelId:       strings.TrimSpace(req.Binding.ModelID),
			RoutePolicy:   req.Binding.RoutePolicy,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     publicChatDefaultTurnTimeoutMs,
			ConnectorId:   strings.TrimSpace(req.Binding.ConnectorID),
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_STREAM,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_TextGenerate{
				TextGenerate: &runtimev1.TextGenerateScenarioSpec{
					Input:        cloneChatMessages(req.Messages),
					SystemPrompt: publicChatSystemPromptWithAPMLOutputContract(req.SystemPrompt),
					MaxTokens:    req.MaxTokens,
					Reasoning:    toProtoReasoningConfig(req.Reasoning),
				},
			},
		},
	}
	return e.ai.StreamScenario(streamReq, &publicChatScenarioStreamServer{
		ctx: ctx,
		send: func(event *runtimev1.StreamScenarioEvent) error {
			if emit == nil {
				return nil
			}
			return emit(event)
		},
	})
}
