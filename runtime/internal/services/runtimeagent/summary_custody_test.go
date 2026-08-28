package runtimeagent

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
)

func seedDuePublicChatConversationSummary(t *testing.T, svc *Service, anchorID string) {
	t.Helper()
	svc.chatSurfaceMu.Lock()
	defer svc.chatSurfaceMu.Unlock()
	anchor := svc.chatAnchors[anchorID]
	if anchor == nil {
		t.Fatalf("conversation anchor %q is absent", anchorID)
	}
	anchor.CommittedTranscript = testPublicChatCommittedTranscript(
		[2]string{"user 0", "assistant 0"},
		[2]string{"user 1", "assistant 1"},
		[2]string{"user 2", "assistant 2"},
		[2]string{"user 3", "assistant 3"},
		[2]string{"user 4", "assistant 4"},
		[2]string{"user 5", "assistant 5"},
		[2]string{"user 6", "assistant 6"},
	)
}

func TestTerminateAgentCancelsAndDrainsConversationSummaryJob(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	svc.SetSourceCognitionBridge(&sourceCognitionBridgeStub{})
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	seedDuePublicChatConversationSummary(t, svc, anchorID)

	baseResolver := svc.currentPublicChatBindingResolver()
	leaseReleased := make(chan struct{})
	var releaseOnce sync.Once
	var releaseCount atomic.Int32
	svc.SetPublicChatBindingResolver(stubPublicChatBindingResolver{resolve: func(ctx context.Context, req PublicChatBindingResolutionRequest) (PublicChatBindingResolution, error) {
		resolved, err := baseResolver.ResolvePublicChatBinding(ctx, req)
		if err != nil {
			return PublicChatBindingResolution{}, err
		}
		resolved.Release = func() {
			releaseCount.Add(1)
			releaseOnce.Do(func() { close(leaseReleased) })
		}
		return resolved, nil
	}})

	providerStarted := make(chan struct{})
	providerCanceled := make(chan struct{})
	allowProviderExit := make(chan struct{})
	var providerStartOnce sync.Once
	var providerCancelOnce sync.Once
	var providerExitOnce sync.Once
	releaseProvider := func() { providerExitOnce.Do(func() { close(allowProviderExit) }) }
	defer releaseProvider()
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{stream: func(
		ctx context.Context,
		_ *PublicChatTurnExecutionRequest,
		_ func(*runtimev1.StreamScenarioEvent) error,
	) error {
		providerStartOnce.Do(func() { close(providerStarted) })
		<-ctx.Done()
		providerCancelOnce.Do(func() { close(providerCanceled) })
		<-allowProviderExit
		return ctx.Err()
	}})

	if !svc.schedulePublicChatConversationSummary(anchorID) {
		t.Fatal("summary job was not scheduled")
	}
	select {
	case <-providerStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("summary provider did not start")
	}

	terminateDone := make(chan error, 1)
	go func() {
		_, err := svc.TerminateAgent(context.Background(), &runtimev1.TerminateAgentRequest{
			Context: testRuntimeAgentIdentityContext("agent-alpha"),
			Reason:  "summary custody test",
		})
		terminateDone <- err
	}()

	select {
	case <-providerCanceled:
	case err := <-terminateDone:
		t.Fatalf("TerminateAgent returned before canceling the summary provider: %v", err)
	case <-time.After(3 * time.Second):
		t.Fatal("termination did not cancel the summary provider")
	}
	select {
	case err := <-terminateDone:
		t.Fatalf("TerminateAgent returned before the canceled summary provider drained: %v", err)
	default:
	}
	releaseProvider()
	select {
	case err := <-terminateDone:
		if err != nil {
			t.Fatalf("TerminateAgent: %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("TerminateAgent did not return after the summary provider drained")
	}
	select {
	case <-leaseReleased:
	default:
		t.Fatal("summary execution lease was not released before termination returned")
	}
	if releaseCount.Load() != 1 {
		t.Fatalf("summary execution lease release count = %d, want 1", releaseCount.Load())
	}
	svc.chatSurfaceMu.Lock()
	_, stillRunning := svc.chatConversationSummaryJobs[anchorID]
	svc.chatSurfaceMu.Unlock()
	if stillRunning {
		t.Fatal("terminated Agent retained a summary job")
	}
}

func TestTerminateAgentCancelsAndDrainsConversationSummaryBindingResolution(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	svc.SetSourceCognitionBridge(&sourceCognitionBridgeStub{})
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	seedDuePublicChatConversationSummary(t, svc, anchorID)

	resolverStarted := make(chan struct{})
	resolverCanceled := make(chan struct{})
	allowResolverExit := make(chan struct{})
	var startOnce sync.Once
	var cancelOnce sync.Once
	var exitOnce sync.Once
	releaseResolver := func() { exitOnce.Do(func() { close(allowResolverExit) }) }
	defer releaseResolver()
	svc.SetPublicChatBindingResolver(stubPublicChatBindingResolver{resolve: func(ctx context.Context, _ PublicChatBindingResolutionRequest) (PublicChatBindingResolution, error) {
		startOnce.Do(func() { close(resolverStarted) })
		<-ctx.Done()
		cancelOnce.Do(func() { close(resolverCanceled) })
		<-allowResolverExit
		return PublicChatBindingResolution{}, ctx.Err()
	}})
	if !svc.schedulePublicChatConversationSummary(anchorID) {
		t.Fatal("summary job was not scheduled")
	}
	select {
	case <-resolverStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("summary binding resolution did not start")
	}

	terminateDone := make(chan error, 1)
	go func() {
		_, err := svc.TerminateAgent(context.Background(), &runtimev1.TerminateAgentRequest{
			Context: testRuntimeAgentIdentityContext("agent-alpha"),
			Reason:  "summary resolver custody test",
		})
		terminateDone <- err
	}()
	select {
	case <-resolverCanceled:
	case err := <-terminateDone:
		t.Fatalf("TerminateAgent returned before canceling summary binding resolution: %v", err)
	case <-time.After(3 * time.Second):
		t.Fatal("termination did not cancel summary binding resolution")
	}
	select {
	case err := <-terminateDone:
		t.Fatalf("TerminateAgent returned before summary binding resolution drained: %v", err)
	default:
	}
	releaseResolver()
	select {
	case err := <-terminateDone:
		if err != nil {
			t.Fatalf("TerminateAgent: %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("TerminateAgent did not return after summary binding resolution drained")
	}
}

func TestConversationSummaryContinuousHighWaterRemainsInTerminationCustody(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	svc.SetSourceCognitionBridge(&sourceCognitionBridgeStub{})
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	seedDuePublicChatConversationSummary(t, svc, anchorID)

	firstStarted := make(chan struct{})
	secondStarted := make(chan struct{})
	thirdStarted := make(chan struct{})
	releaseFirst := make(chan struct{})
	releaseSecond := make(chan struct{})
	thirdCanceled := make(chan struct{})
	allowThirdExit := make(chan struct{})
	var releaseFirstOnce sync.Once
	var releaseSecondOnce sync.Once
	var thirdExitOnce sync.Once
	finishFirst := func() { releaseFirstOnce.Do(func() { close(releaseFirst) }) }
	finishSecond := func() { releaseSecondOnce.Do(func() { close(releaseSecond) }) }
	finishThird := func() { thirdExitOnce.Do(func() { close(allowThirdExit) }) }
	defer finishFirst()
	defer finishSecond()
	defer finishThird()
	var calls atomic.Int32
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{stream: func(
		ctx context.Context,
		_ *PublicChatTurnExecutionRequest,
		emit func(*runtimev1.StreamScenarioEvent) error,
	) error {
		call := calls.Add(1)
		switch call {
		case 1:
			close(firstStarted)
			select {
			case <-releaseFirst:
			case <-ctx.Done():
				return ctx.Err()
			}
		case 2:
			close(secondStarted)
			select {
			case <-releaseSecond:
			case <-ctx.Done():
				return ctx.Err()
			}
		case 3:
			close(thirdStarted)
			<-ctx.Done()
			close(thirdCanceled)
			<-allowThirdExit
			return ctx.Err()
		default:
			return context.Canceled
		}
		text := `<message id="conversation-summary">summary</message>`
		if err := emit(&runtimev1.StreamScenarioEvent{EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA, Payload: &runtimev1.StreamScenarioEvent_Delta{Delta: &runtimev1.ScenarioStreamDelta{Delta: &runtimev1.ScenarioStreamDelta_Text{Text: &runtimev1.TextStreamDelta{Text: text}}}}}); err != nil {
			return err
		}
		return emit(&runtimev1.StreamScenarioEvent{EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED, Payload: &runtimev1.StreamScenarioEvent_Completed{Completed: &runtimev1.ScenarioStreamCompleted{}}})
	}})

	appendTurn := func(sequence uint64) {
		svc.chatSurfaceMu.Lock()
		svc.chatAnchors[anchorID].CommittedTranscript = append(svc.chatAnchors[anchorID].CommittedTranscript, publicChatCommittedTranscriptTurn{
			TurnID: fmt.Sprintf("turn-%d", sequence), Sequence: sequence, Origin: publicChatTurnOriginUser,
			InputText: "advanced user", AssistantText: "advanced assistant",
		})
		svc.chatSurfaceMu.Unlock()
	}
	if !svc.schedulePublicChatConversationSummary(anchorID) {
		t.Fatal("initial summary target was not scheduled")
	}
	select {
	case <-firstStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("first summary attempt did not start")
	}
	appendTurn(7)
	if svc.schedulePublicChatConversationSummary(anchorID) {
		t.Fatal("first high-water advance started another Job")
	}
	finishFirst()
	select {
	case <-secondStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("second summary attempt did not start")
	}
	appendTurn(8)
	if svc.schedulePublicChatConversationSummary(anchorID) {
		t.Fatal("second high-water advance started another Job")
	}

	// A capped implementation deletes the map entry after attempt two and
	// blocks trying to schedule a replacement on this lock. The owned loop
	// must instead reach attempt three without dropping its map/Done custody.
	svc.mu.Lock()
	muLocked := true
	defer func() {
		if muLocked {
			svc.mu.Unlock()
		}
	}()
	finishSecond()
	select {
	case <-thirdStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("summary high-water loop dropped custody before the third attempt")
	}

	terminateDone := make(chan error, 1)
	go func() {
		_, err := svc.TerminateAgent(context.Background(), &runtimev1.TerminateAgentRequest{
			Context: testRuntimeAgentIdentityContext("agent-alpha"),
			Reason:  "continuous summary custody test",
		})
		terminateDone <- err
	}()
	svc.mu.Unlock()
	muLocked = false
	select {
	case <-thirdCanceled:
	case err := <-terminateDone:
		t.Fatalf("TerminateAgent returned before canceling the latest summary attempt: %v", err)
	case <-time.After(3 * time.Second):
		t.Fatal("termination did not cancel the latest summary attempt")
	}
	select {
	case err := <-terminateDone:
		t.Fatalf("TerminateAgent returned before the latest summary attempt drained: %v", err)
	default:
	}
	finishThird()
	select {
	case err := <-terminateDone:
		if err != nil {
			t.Fatalf("TerminateAgent: %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("TerminateAgent did not return after the latest summary attempt drained")
	}
}

func TestFailedTerminateFencesConversationSummaryJob(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	svc.SetSourceCognitionBridge(&sourceCognitionBridgeStub{})
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	seedDuePublicChatConversationSummary(t, svc, anchorID)

	providerStarted := make(chan struct{})
	providerCanceled := make(chan struct{}, 1)
	allowProviderExit := make(chan struct{})
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{stream: func(
		ctx context.Context,
		_ *PublicChatTurnExecutionRequest,
		emit func(*runtimev1.StreamScenarioEvent) error,
	) error {
		close(providerStarted)
		select {
		case <-ctx.Done():
			providerCanceled <- struct{}{}
			return ctx.Err()
		case <-allowProviderExit:
		}
		if err := emit(&runtimev1.StreamScenarioEvent{EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA, Payload: &runtimev1.StreamScenarioEvent_Delta{Delta: &runtimev1.ScenarioStreamDelta{Delta: &runtimev1.ScenarioStreamDelta_Text{Text: &runtimev1.TextStreamDelta{Text: `<message id="conversation-summary">surviving summary</message>`}}}}}); err != nil {
			return err
		}
		return emit(&runtimev1.StreamScenarioEvent{EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED, Payload: &runtimev1.StreamScenarioEvent_Completed{Completed: &runtimev1.ScenarioStreamCompleted{}}})
	}})
	if !svc.schedulePublicChatConversationSummary(anchorID) {
		t.Fatal("summary job was not scheduled")
	}
	select {
	case <-providerStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("summary provider did not start")
	}
	if err := svc.backend.Close(); err != nil {
		t.Fatalf("close persistence backend: %v", err)
	}
	if _, err := svc.TerminateAgent(context.Background(), &runtimev1.TerminateAgentRequest{
		Context: testRuntimeAgentIdentityContext("agent-alpha"),
		Reason:  "forced persistence failure",
	}); err == nil {
		t.Fatal("TerminateAgent unexpectedly succeeded on a closed persistence backend")
	}
	select {
	case <-providerCanceled:
		// Runtime projection deletion failed, but the termination generation
		// fence still prevents the detached Job from committing late summary
		// state into the retained Agent.
	default:
		t.Fatal("failed termination left the summary job outside the lifecycle fence")
	}
	close(allowProviderExit)
	waitForPublicChatAsyncDrain(t, svc)
}

func TestConversationSummaryCapturesExecutionIdentityAndResolvesIndependentBinding(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	seedDuePublicChatConversationSummary(t, svc, anchorID)

	baseResolver := svc.currentPublicChatBindingResolver()
	resolutionStarted := make(chan PublicChatBindingResolutionRequest, 1)
	resolutionSubject := make(chan string, 1)
	allowResolution := make(chan struct{})
	var resolverCalls atomic.Int32
	svc.SetPublicChatBindingResolver(stubPublicChatBindingResolver{resolve: func(ctx context.Context, req PublicChatBindingResolutionRequest) (PublicChatBindingResolution, error) {
		resolverCalls.Add(1)
		identity := authn.IdentityFromContext(ctx)
		if identity != nil {
			resolutionSubject <- identity.SubjectUserID
		} else {
			resolutionSubject <- ""
		}
		resolutionStarted <- req
		select {
		case <-allowResolution:
		case <-ctx.Done():
			return PublicChatBindingResolution{}, ctx.Err()
		}
		return baseResolver.ResolvePublicChatBinding(ctx, req)
	}})

	executionObserved := make(chan *PublicChatTurnExecutionRequest, 1)
	executionAccount := make(chan string, 1)
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{stream: func(
		ctx context.Context,
		req *PublicChatTurnExecutionRequest,
		emit func(*runtimev1.StreamScenarioEvent) error,
	) error {
		account, _ := executionintent.RuntimeAccountSubjectFromContext(ctx)
		executionAccount <- account
		executionObserved <- req
		if err := emit(&runtimev1.StreamScenarioEvent{EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA, Payload: &runtimev1.StreamScenarioEvent_Delta{Delta: &runtimev1.ScenarioStreamDelta{Delta: &runtimev1.ScenarioStreamDelta_Text{Text: &runtimev1.TextStreamDelta{Text: `<message id="conversation-summary">captured summary</message>`}}}}}); err != nil {
			return err
		}
		return emit(&runtimev1.StreamScenarioEvent{EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED, Payload: &runtimev1.StreamScenarioEvent_Completed{Completed: &runtimev1.ScenarioStreamCompleted{}}})
	}})

	if !svc.schedulePublicChatConversationSummary(anchorID) {
		t.Fatal("summary job was not scheduled")
	}
	var resolutionReq PublicChatBindingResolutionRequest
	select {
	case resolutionReq = <-resolutionStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("summary did not acquire an independent canonical execution binding")
	}
	if resolutionReq.SubjectUserID != "user-1" || resolutionReq.Capability != runtimeAgentAIConfigCapabilityTextGenerate {
		t.Fatalf("summary binding request identity = %#v", resolutionReq)
	}
	if subject := <-resolutionSubject; subject != "user-1" {
		t.Fatalf("summary canonical resolver authn subject = %q", subject)
	}

	// Simulate a later caller turn mutating the anchor while the scheduled
	// summary is still resolving its own exact execution binding.
	svc.chatSurfaceMu.Lock()
	anchor := svc.chatAnchors[anchorID]
	anchor.CallerAppID = "later.app"
	anchor.Binding.ModelID = "later-anchor-model"
	anchor.Binding.RouteDigest = strings.Repeat("f", 64)
	svc.chatSurfaceMu.Unlock()
	close(allowResolution)

	var executionReq *PublicChatTurnExecutionRequest
	select {
	case executionReq = <-executionObserved:
	case <-time.After(2 * time.Second):
		t.Fatal("summary execution did not start")
	}
	if executionReq.AppID != "desktop.app" || executionReq.SubjectUserID != "user-1" {
		t.Fatalf("summary execution identity drifted with mutable anchor: app=%q subject=%q", executionReq.AppID, executionReq.SubjectUserID)
	}
	if executionReq.Binding.ModelID != resolutionReq.ModelID || executionReq.Binding.RouteDigest == strings.Repeat("f", 64) {
		t.Fatalf("summary used mutable anchor binding instead of independently resolved binding: %#v", executionReq.Binding)
	}
	select {
	case account := <-executionAccount:
		if account != "user-1" {
			t.Fatalf("summary execution account = %q", account)
		}
	default:
		t.Fatal("summary execution account was not captured")
	}
	waitForPublicChatAsyncDrain(t, svc)
	if resolverCalls.Load() != 1 {
		t.Fatalf("summary canonical resolver calls = %d, want 1", resolverCalls.Load())
	}
}
