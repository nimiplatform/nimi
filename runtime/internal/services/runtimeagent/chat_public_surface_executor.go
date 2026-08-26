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
	case publicChatTurnRequestType, publicChatTurnInterruptType, publicChatTurnVoiceRenderType:
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

const publicChatAPMLOutputContractPromptTemplate = `Runtime APML contract:
- Output APML only. Begin exactly <message id="message-0">; no Markdown, JSON, fences, <think>, or other prose.
%s
- Text: <message id="message-0">reply text</message>. Never self-close <message>; all reply text stays inside <message>.
- Optional inside <message>, at most one each (omit if unsure): <emotion>%s</emotion>; <activity>%s</activity>. "focused" is activity, not emotion.
- Voice: <action id="action-0" kind="voice"><prompt-payload kind="voice"><prompt-text>voice prompt</prompt-text></prompt-payload></action>.
%s
- Follow-up: <time-hook id="hook-0"><delay-ms>600000</delay-ms><effect kind="follow-up-turn"><prompt-text>instruction</prompt-text></effect></time-hook>.
- Message first; then action/time-hook/event-hook siblings; close all tags. FINAL: reply ONLY as <message id="message-0">reply text</message> unless a sibling is required.`

const publicChatRoundOneRecallPrompt = `- If essential source facts are missing, instead output exactly <message id="message-0"><query>one bounded source question</query></message>. This Runtime-private recall is available at most once; the message may contain only the query request and never reply text/actions.`

const publicChatRoundTwoFinalOnlyPrompt = `- Round 2 final-only: a Runtime-private recall result is already present. A second recall is forbidden; output the final user reply now.`

const publicChatImageActionAvailablePrompt = `- Image; all reply text stays in message, with no text between/after tags: <message id="message-0">Creating it.</message><action id="action-0" kind="image"><prompt-payload kind="image"><prompt-text>generation prompt</prompt-text></prompt-payload></action>.
- If the user asks to create, draw, generate, send, or show an image/photo/picture/avatar/selfie/visual, include exactly one sibling <action kind="image"> after the message.
- For an agent photo/avatar/selfie request, use a representative or stylized prompt.`

// publicChatImageActionNotConfiguredPrompt is the truthful K-AGCORE-148 copy
// for the `not_configured` state: no committed image.generate binding exists.
const publicChatImageActionNotConfiguredPrompt = `- Image: image generation is not configured. Do not output <action kind="image">; say a configured image route is required.`

// publicChatImageActionRouteUnavailablePrompt is the truthful K-AGCORE-148
// copy for the `unavailable` state: a committed image binding exists but its
// route is currently not usable. Telling the model the route is unconfigured
// when a committed binding exists is not admitted.
const publicChatImageActionRouteUnavailablePrompt = `- Image route unavailable: Do not output <action kind="image">; say to retry later.`

func publicChatAPMLOutputContractPrompt(actions publicChatAvailableActions) string {
	return publicChatAPMLOutputContractPromptForRound(actions, true)
}

func publicChatAPMLFinalOutputContractPrompt(actions publicChatAvailableActions) string {
	return publicChatAPMLOutputContractPromptForRound(actions, false)
}

func publicChatAPMLOutputContractPromptForRound(actions publicChatAvailableActions, allowRecall bool) string {
	var imagePrompt string
	switch actions.ImageGenerate {
	case publicChatImageActionAvailable:
		imagePrompt = publicChatImageActionAvailablePrompt
	case publicChatImageActionUnavailable:
		imagePrompt = publicChatImageActionRouteUnavailablePrompt
	default:
		imagePrompt = publicChatImageActionNotConfiguredPrompt
	}
	recallPrompt := publicChatRoundOneRecallPrompt
	if !allowRecall {
		recallPrompt = publicChatRoundTwoFinalOnlyPrompt
	}
	return fmt.Sprintf(
		publicChatAPMLOutputContractPromptTemplate,
		recallPrompt,
		strings.Join(publicChatSortedSetKeys(admittedCurrentEmotions), "|"),
		strings.Join(publicChatSortedStringMapKeys(admittedActivityCategories), "|"),
		imagePrompt,
	)
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
	if err := s.Context().Err(); err != nil {
		return err
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
	if ctx == nil {
		ctx = context.Background()
	}
	ctx = withPublicChatExecutionIntent(ctx, req.Binding, req.Binding.CapabilityContract)
	var maxTokens *int32
	if req.MaxTokens != 0 {
		maxTokens = proto.Int32(req.MaxTokens)
	}
	streamReq := &runtimev1.StreamScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         firstNonEmpty(strings.TrimSpace(req.AppID), publicChatRuntimeAppID),
			SubjectUserId: strings.TrimSpace(req.SubjectUserID),
			TimeoutMs:     publicChatDefaultTurnTimeoutMs,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_STREAM,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_TextGenerate{
				TextGenerate: &runtimev1.TextGenerateScenarioSpec{
					Input:        cloneChatMessages(req.Messages),
					SystemPrompt: strings.TrimSpace(req.SystemPrompt),
					MaxTokens:    maxTokens,
					Reasoning:    toProtoReasoningConfig(req.Reasoning),
				},
			},
		},
	}
	stream := &publicChatScenarioStreamServer{
		ctx: ctx,
		send: func(event *runtimev1.StreamScenarioEvent) error {
			if emit == nil {
				return nil
			}
			return emit(event)
		},
	}
	errCh := make(chan error, 1)
	go func() {
		errCh <- e.ai.StreamScenario(streamReq, stream)
	}()
	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
		select {
		case err := <-errCh:
			return err
		default:
			return ctx.Err()
		}
	}
}
