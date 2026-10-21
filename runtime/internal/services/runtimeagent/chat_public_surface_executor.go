package runtimeagent

import (
	"context"
	"fmt"
	"io"
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
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

// @nimi-authority: definition.nimi.runtime.agent-participation.output-wire-plane
const publicChatAPMLOutputContractPromptTemplate = `Runtime APML contract:
- APML only. Declare intent before content: reply=text, recall=query. Begin <message intent="...">. No Markdown or fences.
%s
- Runtime generates all message/action/hook ids; omit ids.
- Text: <message intent="reply">reply text</message>. Replies cannot be empty.
- Optional reply cues, at most one each: <emotion>%s</emotion>; <activity>%s</activity>. "focused" is activity, not emotion.
- Cue example: <message intent="reply"><emotion>neutral</emotion><activity>listening</activity>reply text</message>. Close cues before text; end with </message>, never </activity> or </emotion>.
%s
%s
- No top-level emotion/activity. Close all tags. Choose one admitted response type; private query must never mix with public text or actions.`

const publicChatFollowUpOutputPrompt = `- If you want to add one separate thought after this reply, optionally use <time-hook><delay-ms>30000</delay-ms></time-hook>, delay 1..3600000 ms. Otherwise omit it. Runtime continues this conversation once, then waits for the user. No task prompt, user reminder or deterministic notification.`

const publicChatContinuationInstruction = "Continue the current conversation naturally. This is autonomous continuation, not a user reminder or a delayed task."

const publicChatRoundOneRecallPrompt = `- If essential source facts are missing, instead output exactly <message intent="recall"><query>one bounded source question</query></message>. Runtime-private recall: at most once; query only, no reply text/actions.`

const publicChatRoundTwoFinalOnlyPrompt = `- A Runtime-private recall result is already present. A second recall is forbidden; return a reply.`

const publicChatImageActionAvailablePrompt = `- Image; all reply text stays in message, with no text between/after tags: <message intent="reply">Creating it.</message><action kind="image"><prompt-payload kind="image"><prompt-text>generation prompt</prompt-text></prompt-payload></action>.
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
	followUpPrompt := "- Free proactive contact is disabled for this Agent. Do not propose autonomous time hooks. User tasks never become a hook."
	if actions.FollowUpEnabled {
		followUpPrompt = publicChatFollowUpOutputPrompt
	}
	if actions.TextOnly {
		imagePrompt = "- This round only renders a reply. Do not propose new image, voice, or follow-up actions."
		followUpPrompt = ""
	}
	recallPrompt := publicChatRoundOneRecallPrompt
	if !allowRecall {
		recallPrompt = publicChatRoundTwoFinalOnlyPrompt
	}
	prompt := fmt.Sprintf(
		publicChatAPMLOutputContractPromptTemplate,
		recallPrompt,
		strings.Join(publicChatSortedSetKeys(admittedCurrentEmotions), "|"),
		strings.Join(publicChatSortedStringMapKeys(admittedActivityCategories), "|"),
		imagePrompt,
		followUpPrompt,
	)
	if !actions.TextOnly {
		prompt += "\n" + selfIntentionPrompt
	}
	return prompt
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
	} else {
		// @nimi-authority: rule.nimi.runtime.ai-provider.internal-output-budget
		ctx = textbehavior.WithInternalOutputBudget(ctx, req.ReservedOutputTokens)
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
					ResponseFormat: req.ResponseFormat,
					Input:          cloneChatMessages(req.Messages),
					Tools:          req.Tools,
					SystemPrompt:   strings.TrimSpace(req.SystemPrompt),
					MaxTokens:      maxTokens,
					Reasoning:      toProtoReasoningConfig(req.Reasoning),
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
	// Resource admission is released by the caller when this returns. Waiting
	// for the real worker prevents a canceled stream from overlapping a new
	// foreground generation while its provider still owns the execution slot.
	err := e.ai.StreamScenario(streamReq, stream)
	if err == nil {
		err = ctx.Err()
	}
	return err
}
