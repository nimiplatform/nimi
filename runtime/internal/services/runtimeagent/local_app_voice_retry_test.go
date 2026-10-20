package runtimeagent

import (
	"context"
	"fmt"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	runtimeartifact "github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
)

type retryVoiceSynth func(voiceLipsyncSynthesisInput) (voiceLipsyncSynthesisOutput, error)

func (f retryVoiceSynth) synthesize(in voiceLipsyncSynthesisInput) (voiceLipsyncSynthesisOutput, error) {
	return f(in)
}

func setupVoiceRetry(t *testing.T, svc *Service) (context.Context, *runtimev1.RenderLocalAppConversationVoiceRequest, accountservice.LocalAppCallerDecision) {
	t.Helper()
	upsertPublicChatTestAgentAIConfig(t, svc, publicChatTestAudioSynthesizeBinding())
	anchor := openPublicChatTestAnchorWithMetadata(t, svc, "agent-alpha", "desktop.app", "user-1", publicChatVoicePolicyMetadata(t, false))
	presentationContext := testLocalAgentContext("user-1", "agent-alpha")
	presentationContext.AppId = "desktop.app"
	if _, err := setTestAgentPresentationProfile(svc, context.Background(), &runtimev1.SetAgentPresentationProfileRequest{Context: presentationContext, ExpectedRevision: proto.Uint64(0), AgentId: presentationContext.GetLocalAgentRef(), Mutation: &runtimev1.SetAgentPresentationProfileRequest_Patch{Patch: &runtimev1.AgentPresentationProfilePatch{DefaultVoiceReference: proto.String("preset_voice_id:nimi-default")}}}); err != nil {
		t.Fatal(err)
	}
	const turnID = "turn-retry-voice"
	if err := svc.commitPublicChatTranscriptTurn(context.Background(), anchor, turnID, publicChatTurnOriginUser, "Read it", nil, "Original committed body", nil); err != nil {
		t.Fatal(err)
	}
	svc.chatSurfaceMu.Lock()
	svc.chatAnchors[anchor].CompletedTurnSnapshots = map[string]*publicChatTurnProjectionState{turnID: {TurnID: turnID, StreamID: "stream-retry-voice", Status: publicChatTurnStatusCompleted, TimelineStartedAt: time.Now(), AssistantText: "Original committed body"}}
	svc.chatSurfaceMu.Unlock()
	decision := localAppConversationDecision(accountservice.LocalAppOperationConversationVoiceRender, 0x60, "user-1")
	svc.SetLocalAppIngressRevalidator(localAppIngressRevalidatorFunc(func(ctx context.Context, _ localappop.Ingress) (context.Context, error) {
		return accountservice.ContextWithAuthorizedLocalAppDecision(ctx, decision), nil
	}))
	req := &runtimev1.RenderLocalAppConversationVoiceRequest{AgentHandle: mintLocalAppAgentHandle(decision, testRuntimeAgentLocalRef("agent-alpha")), ConversationAnchorId: anchor, MessageId: localAppConversationMessageID(turnID, "assistant", ""), RequestId: "attempt-1"}
	return accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision), req, decision
}

func voiceRetryOutput(t *testing.T, svc *Service) voiceLipsyncSynthesisOutput {
	t.Helper()
	if err := svc.runtimeArtifacts.Put("retry-audio", runtimeartifact.ArtifactRecord{Bytes: []byte{1, 2, 3}, MimeType: "audio/wav"}); err != nil {
		t.Fatal(err)
	}
	return voiceLipsyncSynthesisOutput{AudioArtifactID: "retry-audio", AudioMimeType: "audio/wav"}
}

func TestVoiceRetryFailureThenSuccessAndRequestClaimsSurviveRestart(t *testing.T) {
	path := t.TempDir() + "/state.json"
	svc, closeSvc := newRuntimeAgentServiceForPublicChatStatePathWithClose(t, path)
	ctx, req, decision := setupVoiceRetry(t, svc)
	calls := 0
	svc.voiceLipsync = retryVoiceSynth(func(in voiceLipsyncSynthesisInput) (voiceLipsyncSynthesisOutput, error) {
		calls++
		if in.Text != "Original committed body" {
			t.Fatalf("text changed: %q", in.Text)
		}
		return voiceLipsyncSynthesisOutput{}, fmt.Errorf("provider unavailable")
	})
	first, err := svc.RenderLocalAppConversationVoice(ctx, req)
	if err != nil || first.GetVoice().GetArtifactId() != "" {
		t.Fatalf("first=%v err=%v", first, err)
	}
	second, err := svc.RenderLocalAppConversationVoice(ctx, req)
	if err != nil || second.GetVoice().GetState() != runtimev1.LocalAppConversationVoiceState_LOCAL_APP_CONVERSATION_VOICE_STATE_FAILED || calls != 1 {
		t.Fatalf("duplicate launched work: calls=%d err=%v", calls, err)
	}
	closeSvc()
	restarted, closeRestarted := newRuntimeAgentServiceForPublicChatStatePathWithClose(t, path)
	defer closeRestarted()
	decision.SessionID[0]++ // A real rebind has a fresh technical session and opaque handle.
	ctx = accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision)
	req.AgentHandle = mintLocalAppAgentHandle(decision, testRuntimeAgentLocalRef("agent-alpha"))
	restarted.SetLocalAppIngressRevalidator(localAppIngressRevalidatorFunc(func(ctx context.Context, _ localappop.Ingress) (context.Context, error) {
		return accountservice.ContextWithAuthorizedLocalAppDecision(ctx, decision), nil
	}))
	restarted.voiceLipsync = retryVoiceSynth(func(in voiceLipsyncSynthesisInput) (voiceLipsyncSynthesisOutput, error) {
		calls++
		return voiceRetryOutput(t, restarted), nil
	})
	if _, err = restarted.RenderLocalAppConversationVoice(ctx, req); err != nil || calls != 1 {
		t.Fatalf("restart replay: %v calls=%d", err, calls)
	}
	upsertPublicChatTestAgentAIConfig(t, restarted, publicChatTestAudioSynthesizeBinding())
	req.RequestId = "attempt-2"
	ready, err := restarted.RenderLocalAppConversationVoice(ctx, req)
	if err != nil || ready.GetVoice().GetArtifactId() != "retry-audio" || ready.GetVoice().GetVoiceId() != first.GetVoice().GetVoiceId() || calls != 2 {
		t.Fatalf("retry=%v err=%v calls=%d", ready, err, calls)
	}
	req.RequestId = "attempt-3"
	if _, err = restarted.RenderLocalAppConversationVoice(ctx, req); err != nil || calls != 2 {
		t.Fatalf("ready was synthesized again: %v %d", err, calls)
	}
}

func TestVoiceRetryConcurrentRequestsShareAttemptAndRejectLateRevokedOutput(t *testing.T) {
	for _, revoke := range []bool{false, true} {
		t.Run(fmt.Sprint(revoke), func(t *testing.T) {
			svc := newRuntimeAgentServiceForPublicChatTest(t)
			ctx, req, decision := setupVoiceRetry(t, svc)
			started, release := make(chan struct{}), make(chan struct{})
			var calls atomic.Int32
			svc.voiceLipsync = retryVoiceSynth(func(in voiceLipsyncSynthesisInput) (voiceLipsyncSynthesisOutput, error) {
				calls.Add(1)
				close(started)
				<-release
				return voiceRetryOutput(t, svc), nil
			})
			results := make(chan error, 2)
			go func() { _, err := svc.RenderLocalAppConversationVoice(ctx, req); results <- err }()
			<-started
			other := proto.Clone(req).(*runtimev1.RenderLocalAppConversationVoiceRequest)
			other.RequestId = "concurrent-request"
			go func() { _, err := svc.RenderLocalAppConversationVoice(ctx, other); results <- err }()
			// Observe durable admission of the other request before releasing the provider.
			deadline := time.Now().Add(time.Second)
			for {
				svc.chatSurfaceMu.Lock()
				n := len(svc.chatAnchors[req.ConversationAnchorId].VoiceRenderRequests)
				svc.chatSurfaceMu.Unlock()
				if n == 2 {
					break
				}
				if time.Now().After(deadline) {
					t.Fatal("concurrent request not admitted")
				}
				time.Sleep(time.Millisecond)
			}
			if revoke {
				svc.SetLocalAppIngressRevalidator(localAppIngressRevalidatorFunc(func(context.Context, localappop.Ingress) (context.Context, error) {
					return nil, status.Error(codes.PermissionDenied, "revoked")
				}))
			}
			close(release)
			for range 2 {
				err := <-results
				if revoke && status.Code(err) != codes.PermissionDenied {
					t.Fatalf("revoked result=%v", err)
				}
				if !revoke && err != nil {
					t.Fatal(err)
				}
			}
			if calls.Load() != 1 {
				t.Fatalf("duplicate charge: %d", calls.Load())
			}
			voice := svc.localAppConversationVoiceForTurn(req.ConversationAnchorId, "turn-retry-voice")
			if revoke && voice != nil {
				t.Fatal("revoked late voice published")
			}
			if !revoke && (voice == nil || voice.State != "ready") {
				t.Fatal("ready voice missing")
			}
			_ = decision
		})
	}
}

func TestVoiceRetryCanceledAttemptDoesNotPublishOrReplay(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	ctx, req, _ := setupVoiceRetry(t, svc)
	canceled, cancel := context.WithCancel(ctx)
	calls := 0
	svc.voiceLipsync = retryVoiceSynth(func(in voiceLipsyncSynthesisInput) (voiceLipsyncSynthesisOutput, error) {
		calls++
		cancel()
		return voiceRetryOutput(t, svc), nil
	})
	if _, err := svc.RenderLocalAppConversationVoice(canceled, req); err != context.Canceled {
		t.Fatalf("cancel result=%v", err)
	}
	if svc.localAppConversationVoiceForTurn(req.ConversationAnchorId, "turn-retry-voice") != nil {
		t.Fatal("canceled output published")
	}
	if _, err := svc.RenderLocalAppConversationVoice(ctx, req); status.Code(err) != codes.Canceled || calls != 1 {
		t.Fatalf("abandoned request replayed: %v %d", err, calls)
	}
}

func TestVoiceRetryPersistenceFailurePreservesOldFailure(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	ctx, req, _ := setupVoiceRetry(t, svc)
	svc.voiceLipsync = retryVoiceSynth(func(voiceLipsyncSynthesisInput) (voiceLipsyncSynthesisOutput, error) {
		return voiceLipsyncSynthesisOutput{}, fmt.Errorf("first failure")
	})
	if _, err := svc.RenderLocalAppConversationVoice(ctx, req); err != nil {
		t.Fatal(err)
	}
	before := svc.localAppConversationVoiceForTurn(req.ConversationAnchorId, "turn-retry-voice")
	svc.voiceLipsync = retryVoiceSynth(func(voiceLipsyncSynthesisInput) (voiceLipsyncSynthesisOutput, error) {
		out := voiceRetryOutput(t, svc)
		if _, err := svc.backend.DB().Exec(`CREATE TRIGGER voice_save_fail BEFORE UPDATE ON runtime_conversation_anchor BEGIN SELECT RAISE(FAIL, 'voice persistence failure'); END`); err != nil {
			t.Fatal(err)
		}
		return out, nil
	})
	req.RequestId = "attempt-2"
	if _, err := svc.RenderLocalAppConversationVoice(ctx, req); err == nil {
		t.Fatal("failed save reported success")
	}
	after := svc.localAppConversationVoiceForTurn(req.ConversationAnchorId, "turn-retry-voice")
	if after == nil || *before != *after {
		t.Fatalf("old failure lost: %v", after)
	}
}

func TestVoiceRetryCallerScopeMatchesJobKeyAndBoundsLongRequestID(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	ctx, req, decision := setupVoiceRetry(t, svc)
	req.RequestId = strings.Repeat("x", localAppConversationMaxRequestIDBytes)
	var keys []string
	svc.voiceLipsync = retryVoiceSynth(func(in voiceLipsyncSynthesisInput) (voiceLipsyncSynthesisOutput, error) {
		keys = append(keys, in.IdempotencyKey)
		return voiceLipsyncSynthesisOutput{}, fmt.Errorf("provider failure")
	})
	if _, err := svc.RenderLocalAppConversationVoice(ctx, req); err != nil {
		t.Fatal(err)
	}
	// A different registered App may independently use the same local request ID.
	decision.RegisteredAppSubject = "another-registered-app"
	decision.SessionID[0]++
	req.AgentHandle = mintLocalAppAgentHandle(decision, testRuntimeAgentLocalRef("agent-alpha"))
	svc.SetLocalAppIngressRevalidator(localAppIngressRevalidatorFunc(func(ctx context.Context, _ localappop.Ingress) (context.Context, error) {
		return accountservice.ContextWithAuthorizedLocalAppDecision(ctx, decision), nil
	}))
	if _, err := svc.RenderLocalAppConversationVoice(accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision), req); err != nil {
		t.Fatal(err)
	}
	if len(keys) != 2 || keys[0] == keys[1] || len(keys[0]) > 256 || len(keys[1]) > 256 {
		t.Fatalf("invalid scoped Job keys: %v", keys)
	}
}

func TestVoiceRetryCompleteTextSurvivesMediaTerminalAndPartialStillRejected(t *testing.T) {
	for _, terminal := range []string{publicChatTurnStatusInterrupted, publicChatTurnStatusFailed, publicChatTurnStatusCommitted} {
		t.Run(terminal, func(t *testing.T) {
			svc := newRuntimeAgentServiceForPublicChatTest(t)
			ctx, req, _ := setupVoiceRetry(t, svc)
			svc.chatSurfaceMu.Lock()
			svc.chatAnchors[req.ConversationAnchorId].CompletedTurnSnapshots["turn-retry-voice"].Status = terminal
			svc.chatSurfaceMu.Unlock()
			calls := 0
			svc.voiceLipsync = retryVoiceSynth(func(voiceLipsyncSynthesisInput) (voiceLipsyncSynthesisOutput, error) {
				calls++
				return voiceRetryOutput(t, svc), nil
			})
			reply, err := svc.RenderLocalAppConversationVoice(ctx, req)
			if terminal == publicChatTurnStatusCommitted {
				if err == nil || calls != 0 {
					t.Fatal("active automatic voice may overlap")
				}
				return
			}
			if err != nil || reply.GetVoice().GetArtifactId() == "" {
				t.Fatalf("complete body blocked by optional media %s: %v", terminal, err)
			}
		})
	}
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	ctx, req, _ := setupVoiceRetry(t, svc)
	svc.chatSurfaceMu.Lock()
	svc.chatAnchors[req.ConversationAnchorId].CommittedTranscript = nil
	svc.chatSurfaceMu.Unlock()
	if _, err := svc.RenderLocalAppConversationVoice(ctx, req); err == nil {
		t.Fatal("uncommitted partial synthesized")
	}
}

type voiceCommitTestFence struct {
	authorize    localAppIngressRevalidatorFunc
	beforeCommit func()
}

func (f voiceCommitTestFence) AuthorizeLocalAppIngress(ctx context.Context, ingress localappop.Ingress) (context.Context, error) {
	return f.authorize(ctx, ingress)
}
func (f voiceCommitTestFence) CommitLocalAppIngress(ctx context.Context, ingress localappop.Ingress, commit func(context.Context) error) error {
	f.beforeCommit()
	current, err := f.authorize(ctx, ingress)
	if err != nil {
		return err
	}
	return commit(current)
}

func TestVoiceRetryRejectsTerminationAndCancellationAtCommit(t *testing.T) {
	for _, mode := range []string{"termination", "cancel-at-commit"} {
		t.Run(mode, func(t *testing.T) {
			svc := newRuntimeAgentServiceForPublicChatTest(t)
			ctx, req, decision := setupVoiceRetry(t, svc)
			ctx, cancel := context.WithCancel(ctx)
			defer cancel()
			if mode == "cancel-at-commit" {
				svc.SetLocalAppIngressRevalidator(voiceCommitTestFence{authorize: func(c context.Context, _ localappop.Ingress) (context.Context, error) {
					return accountservice.ContextWithAuthorizedLocalAppDecision(c, decision), nil
				}, beforeCommit: cancel})
			}
			svc.voiceLipsync = retryVoiceSynth(func(voiceLipsyncSynthesisInput) (voiceLipsyncSynthesisOutput, error) {
				if mode == "termination" {
					svc.chatSurfaceMu.Lock()
					svc.chatTerminatingAgents[testRuntimeAgentLocalRef("agent-alpha")] = 1
					svc.chatSurfaceMu.Unlock()
				}
				return voiceRetryOutput(t, svc), nil
			})
			if _, err := svc.RenderLocalAppConversationVoice(ctx, req); err == nil {
				t.Fatal("ended owner published success")
			}
			if svc.localAppConversationVoiceForTurn(req.ConversationAnchorId, "turn-retry-voice") != nil {
				t.Fatal("late sidecar persisted")
			}
			if mode == "termination" {
				svc.chatSurfaceMu.Lock()
				delete(svc.chatTerminatingAgents, testRuntimeAgentLocalRef("agent-alpha"))
				svc.chatSurfaceMu.Unlock()
			}
		})
	}
}
