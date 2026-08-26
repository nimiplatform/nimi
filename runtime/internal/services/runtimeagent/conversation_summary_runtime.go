package runtimeagent

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const publicChatRecentVerbatimTurnLimit = 6
const publicChatConversationSummaryMaxBytes = 6000
const publicChatConversationSummaryInputMaxBytes = 64 * 1024

var errPublicChatConversationSummaryUnavailable = errors.New("conversation summary persistence unavailable")

func validatePublicChatConversationSummary(summary *publicChatConversationSummaryState, transcript []publicChatCommittedTranscriptTurn) error {
	if summary == nil {
		return nil
	}
	attempt := summary.LastAttempt
	if !admittedPublicChatConversationSummaryAttemptStatus(attempt.Status) || attempt.TargetSequenceEnd >= uint64(len(transcript)) || attempt.AttemptedAt.IsZero() {
		return fmt.Errorf("Runtime conversation summary is invalid")
	}
	valid := summary.LastValid
	if valid != nil && (valid.Revision == 0 || valid.CoveredSequenceStart != 0 || valid.CoveredSequenceEnd >= uint64(len(transcript)) || strings.TrimSpace(valid.Text) == "" || valid.Text != strings.TrimSpace(valid.Text) || len(valid.Text) > publicChatConversationSummaryMaxBytes || valid.GeneratedAt.IsZero() || !validSHA256Hex(valid.RouteCorrelation)) {
		return fmt.Errorf("Runtime conversation summary is invalid")
	}
	if attempt.Status == "ready" {
		if valid == nil || valid.CoveredSequenceEnd != attempt.TargetSequenceEnd {
			return fmt.Errorf("Runtime conversation summary ready attempt has no matching valid summary")
		}
	} else if valid != nil && valid.CoveredSequenceEnd >= attempt.TargetSequenceEnd {
		return fmt.Errorf("Runtime conversation summary failed attempt does not advance the valid summary")
	}
	return nil
}

func admittedPublicChatConversationSummaryAttemptStatus(value string) bool {
	return value == "ready" || value == "failed" || value == "unavailable"
}

type publicChatConversationSummaryJob struct {
	Identity     publicChatConversationSummaryIdentity
	LatestTarget uint64
	Dirty        bool
	Context      context.Context
	Cancel       context.CancelFunc
	Done         chan struct{}
	finishOnce   sync.Once
}

func (job *publicChatConversationSummaryJob) finish() {
	if job == nil {
		return
	}
	job.finishOnce.Do(func() {
		if job.Cancel != nil {
			job.Cancel()
		}
		close(job.Done)
	})
}

// Identity is immutable for the lifetime of one coalesced per-anchor Job.
// A later turn can advance work, but cannot change the Job's account or App.
type publicChatConversationSummaryIdentity struct {
	AgentID          string
	RuntimeSourceRef string
	OwnerUserID      string
	SubjectUserID    string
	CallerAppID      string
}

// Execution is the immutable input/binding carrier for one target attempt.
// Release owns the canonical resolver lease and is transferred exactly once.
type publicChatConversationSummaryExecution struct {
	Input   string
	Binding publicChatExecutionBinding
	Release func()
}

func (execution *publicChatConversationSummaryExecution) release() {
	if execution == nil || execution.Release == nil {
		return
	}
	release := execution.Release
	execution.Release = nil
	release()
}

// @nimi-authority: rule.nimi.runtime.agent-participation.r185
func (s *Service) schedulePublicChatConversationSummary(anchorID string) bool {
	if s == nil {
		return false
	}
	anchorID = strings.TrimSpace(anchorID)
	if anchorID == "" {
		return false
	}

	// Publish Agent-scoped custody before any catalog or provider I/O. This
	// gives termination one cancel/done boundary for resolving and executing.
	s.mu.RLock()
	s.chatSurfaceMu.Lock()
	if s.isClosed() {
		s.chatSurfaceMu.Unlock()
		s.mu.RUnlock()
		return false
	}
	anchor := clonePublicChatAnchorState(s.chatAnchors[anchorID])
	targetEnd, due, err := pendingPublicChatConversationSummaryTargetForAnchor(anchor)
	if err != nil {
		s.chatSurfaceMu.Unlock()
		s.mu.RUnlock()
		if s.logger != nil {
			s.logger.Warn("conversation summary target could not be resolved", "status", "failure", "error", err)
		}
		return false
	}
	if !due {
		s.chatSurfaceMu.Unlock()
		s.mu.RUnlock()
		return false
	}
	running := s.chatConversationSummaryJobs[anchorID]
	identity, err := s.capturePublicChatConversationSummaryIdentityLocked(anchor, running)
	if err != nil {
		s.chatSurfaceMu.Unlock()
		s.mu.RUnlock()
		if s.logger != nil {
			s.logger.Warn("conversation summary execution custody could not be captured", "status", "failure", "error", err)
		}
		return false
	}
	if s.chatConversationSummaryJobs == nil {
		s.chatConversationSummaryJobs = make(map[string]*publicChatConversationSummaryJob)
	}
	if running != nil {
		if targetEnd > running.LatestTarget && running.Identity == identity {
			running.LatestTarget = targetEnd
			running.Dirty = true
		}
		s.chatSurfaceMu.Unlock()
		s.mu.RUnlock()
		return false
	}
	lifetime := s.chatAsyncLifecycleCtx
	if lifetime == nil {
		lifetime = context.Background()
	}
	lifetime = runtimeAgentImageActionContext(lifetime, identity.CallerAppID, identity.OwnerUserID)
	lifetime = executionintent.WithRuntimeAccountSubject(lifetime, identity.OwnerUserID)
	jobCtx, cancel := context.WithCancel(lifetime)
	job := &publicChatConversationSummaryJob{
		Identity: identity, LatestTarget: targetEnd,
		Context: jobCtx, Cancel: cancel, Done: make(chan struct{}),
	}
	s.chatConversationSummaryJobs[anchorID] = job
	s.chatAsyncWG.Add(1)
	s.chatSurfaceMu.Unlock()
	s.mu.RUnlock()
	go func() {
		defer s.chatAsyncWG.Done()
		defer job.finish()
		s.runPublicChatConversationSummaryJob(anchorID, job)
	}()
	return true
}

func (s *Service) runPublicChatConversationSummaryJob(anchorID string, job *publicChatConversationSummaryJob) {
	for {
		s.chatSurfaceMu.Lock()
		current := s.chatConversationSummaryJobs[anchorID]
		if current != job {
			s.chatSurfaceMu.Unlock()
			return
		}
		targetEnd := current.LatestTarget
		identity := current.Identity
		current.Dirty = false
		s.chatSurfaceMu.Unlock()

		if err := s.runPublicChatConversationSummaryAttemptAtTarget(job.Context, anchorID, targetEnd, identity); err != nil && s.logger != nil {
			s.logger.Warn("conversation summary update did not complete", "status", "failure", "error", err)
		}
		s.chatSurfaceMu.Lock()
		current = s.chatConversationSummaryJobs[anchorID]
		if current != job {
			s.chatSurfaceMu.Unlock()
			return
		}
		latestTarget := current.LatestTarget
		advanced := current.Dirty && latestTarget > targetEnd
		if advanced && !s.isClosed() {
			s.chatSurfaceMu.Unlock()
			continue
		}
		// Publish completion before the map entry disappears. Therefore a
		// terminator that cannot find this Job also cannot outrun its Done edge.
		job.finish()
		delete(s.chatConversationSummaryJobs, anchorID)
		s.chatSurfaceMu.Unlock()
		return
	}
}

// detachAgentPublicChatConversationSummaryJobsLocked removes only the target
// Agent's scheduled summary work. The caller holds chatSurfaceMu after the
// hard-delete transaction commits, cancels the returned Jobs, then waits on
// Done only after releasing Runtime locks.
func (s *Service) detachAgentPublicChatConversationSummaryJobsLocked(localAgentRef string) []*publicChatConversationSummaryJob {
	ref := strings.TrimSpace(localAgentRef)
	if ref == "" || len(s.chatConversationSummaryJobs) == 0 {
		return nil
	}
	jobs := make([]*publicChatConversationSummaryJob, 0, 1)
	for anchorID, job := range s.chatConversationSummaryJobs {
		if job == nil || strings.TrimSpace(job.Identity.AgentID) != ref {
			continue
		}
		delete(s.chatConversationSummaryJobs, anchorID)
		jobs = append(jobs, job)
	}
	return jobs
}

func pendingPublicChatConversationSummaryTargetForAnchor(anchor *publicChatAnchorState) (uint64, bool, error) {
	if anchor == nil {
		return 0, false, nil
	}
	targetEnd, shouldSummarize, err := publicChatConversationSummaryTarget(anchor)
	if err != nil || !shouldSummarize {
		return targetEnd, false, err
	}
	if valid := publicChatLastValidConversationSummary(anchor.ConversationSummary); valid != nil && valid.CoveredSequenceEnd >= targetEnd {
		return targetEnd, false, nil
	}
	if state := anchor.ConversationSummary; state != nil && !state.LastAttempt.AttemptedAt.IsZero() && state.LastAttempt.TargetSequenceEnd >= targetEnd {
		return targetEnd, false, nil
	}
	return targetEnd, true, nil
}

func (s *Service) capturePublicChatConversationSummaryIdentityLocked(anchor *publicChatAnchorState, running *publicChatConversationSummaryJob) (publicChatConversationSummaryIdentity, error) {
	if anchor == nil {
		return publicChatConversationSummaryIdentity{}, fmt.Errorf("conversation summary execution anchor is absent")
	}
	identity := publicChatConversationSummaryIdentity{
		AgentID:          strings.TrimSpace(firstNonEmpty(anchor.LocalAgentRef, anchor.AgentID)),
		RuntimeSourceRef: strings.TrimSpace(anchor.RuntimeSourceRef),
		OwnerUserID:      strings.TrimSpace(anchor.OwnerUserID),
		SubjectUserID:    strings.TrimSpace(anchor.SubjectUserID),
		CallerAppID:      strings.TrimSpace(anchor.CallerAppID),
	}
	if identity.AgentID == "" || identity.RuntimeSourceRef == "" || identity.OwnerUserID == "" || identity.SubjectUserID == "" || identity.CallerAppID == "" || identity.OwnerUserID != identity.SubjectUserID {
		return publicChatConversationSummaryIdentity{}, fmt.Errorf("conversation summary execution custody is invalid")
	}
	entry := s.agents[identity.AgentID]
	agentIdentity := localAgentIdentity{OwnerUserID: identity.OwnerUserID, RuntimeSourceRef: identity.RuntimeSourceRef, LocalAgentRef: identity.AgentID}
	if entry == nil || entry.Agent == nil || validateLocalAgentRecordIdentity(entry.Agent, agentIdentity) != nil || entry.Agent.GetLifecycleStatus() != runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE {
		return publicChatConversationSummaryIdentity{}, fmt.Errorf("conversation summary Agent execution custody is not active")
	}
	if running != nil {
		if running.Identity.AgentID != identity.AgentID || running.Identity.RuntimeSourceRef != identity.RuntimeSourceRef || running.Identity.OwnerUserID != identity.OwnerUserID || running.Identity.SubjectUserID != identity.SubjectUserID {
			return publicChatConversationSummaryIdentity{}, fmt.Errorf("conversation summary coalesced execution identity changed")
		}
		identity = running.Identity
	}
	return identity, nil
}

func (s *Service) resolvePublicChatConversationSummaryExecution(ctx context.Context, identity publicChatConversationSummaryIdentity, execution publicChatConversationSummaryExecution) (publicChatConversationSummaryExecution, error) {
	ctx = runtimeAgentImageActionContext(ctx, identity.CallerAppID, identity.OwnerUserID)
	ctx = executionintent.WithRuntimeAccountSubject(ctx, identity.OwnerUserID)
	bindings, err := s.machineExecutionBindingsForCapabilities(ctx, identity.OwnerUserID, runtimeAgentAIConfigCapabilityTextGenerate)
	if err != nil {
		return publicChatConversationSummaryExecution{}, err
	}
	textBinding, ok := bindings[runtimeAgentAIConfigCapabilityTextGenerate]
	if !ok {
		return publicChatConversationSummaryExecution{}, unresolvedSharedAIConfigExecutionBindingError()
	}
	resolved, release, err := s.resolvePublicChatTextExecutionBinding(ctx, identity.OwnerUserID, textBinding, publicChatConversationSummaryResolutionRequest(execution.Input))
	if err != nil {
		return publicChatConversationSummaryExecution{}, err
	}
	cloned := clonePublicChatExecutionBindings(publicChatExecutionBindings{runtimeAgentAIConfigCapabilityTextGenerate: resolved})
	execution.Binding = cloned[runtimeAgentAIConfigCapabilityTextGenerate]
	execution.Release = release
	return execution, nil
}

const publicChatConversationSummarySystemPrompt = "Summarize the supplied committed conversation turns for future continuity. Preserve only user goals, decisions, named entities, relationships, unresolved questions, and durable context. Do not invent facts. Return exactly one APML <message id=\"conversation-summary\"> root and no actions."

func publicChatConversationSummaryResolutionRequest(input string) publicChatTurnRequestPayload {
	return publicChatTurnRequestPayload{
		Messages: []publicChatMessagePayload{
			{Role: "system", Content: publicChatConversationSummarySystemPrompt},
			{Role: "user", Content: strings.TrimSpace(input)},
		},
		MaxOutputTokens: 512,
	}
}

func publicChatConversationSummaryProviderMessages(input string) []*runtimev1.ChatMessage {
	return []*runtimev1.ChatMessage{
		{Role: "system", Content: publicChatConversationSummarySystemPrompt},
		{Role: "user", Content: strings.TrimSpace(input)},
	}
}

func (s *Service) runPublicChatConversationSummaryAttemptAtTarget(ctx context.Context, anchorID string, targetEnd uint64, identity publicChatConversationSummaryIdentity) error {
	if s == nil {
		return nil
	}
	execution := publicChatConversationSummaryExecution{}
	defer func() { execution.release() }()
	attemptCtx, attemptCancel := context.WithTimeout(ctx, 45*time.Second)
	defer attemptCancel()
	s.chatSurfaceMu.Lock()
	anchor := clonePublicChatAnchorState(s.chatAnchors[strings.TrimSpace(anchorID)])
	s.chatSurfaceMu.Unlock()
	if anchor == nil {
		return nil
	}
	if targetEnd >= uint64(len(anchor.CommittedTranscript)) {
		return fmt.Errorf("conversation summary target is no longer valid")
	}
	if valid := publicChatLastValidConversationSummary(anchor.ConversationSummary); valid != nil && valid.CoveredSequenceEnd >= targetEnd {
		return nil
	}
	if state := anchor.ConversationSummary; state != nil && !state.LastAttempt.AttemptedAt.IsZero() && state.LastAttempt.TargetSequenceEnd >= targetEnd {
		return nil
	}
	input, err := publicChatConversationSummaryInput(anchor, targetEnd)
	if err != nil {
		if attemptErr := s.commitPublicChatConversationSummaryAttempt(anchor.ConversationAnchorID, targetEnd, "failed"); attemptErr != nil {
			return fmt.Errorf("conversation summary input failed (%v) and its typed status could not be persisted: %w", err, attemptErr)
		}
		return err
	}
	execution.Input = input
	resolvedExecution, err := s.resolvePublicChatConversationSummaryExecution(attemptCtx, identity, execution)
	if err != nil {
		attemptStatus := publicChatConversationSummaryAttemptStatusForError(err)
		if attemptErr := s.commitPublicChatConversationSummaryAttempt(anchor.ConversationAnchorID, targetEnd, attemptStatus); attemptErr != nil {
			return fmt.Errorf("conversation summary binding failed (%v) and its typed status could not be persisted: %w", err, attemptErr)
		}
		return err
	}
	execution = resolvedExecution
	summaryText, err := s.executePublicChatConversationSummaryWithExecution(attemptCtx, identity, execution)
	if err != nil {
		attemptStatus := publicChatConversationSummaryAttemptStatusForError(err)
		if attemptErr := s.commitPublicChatConversationSummaryAttempt(anchor.ConversationAnchorID, targetEnd, attemptStatus); attemptErr != nil {
			return fmt.Errorf("conversation summary attempt failed (%v) and its typed status could not be persisted: %w", err, attemptErr)
		}
		return err
	}
	if err := s.commitPublicChatConversationSummary(anchor.ConversationAnchorID, targetEnd, summaryText, execution.Binding.RouteDigest); err != nil {
		attemptStatus := publicChatConversationSummaryAttemptStatusForError(err)
		if attemptErr := s.commitPublicChatConversationSummaryAttempt(anchor.ConversationAnchorID, targetEnd, attemptStatus); attemptErr != nil {
			return fmt.Errorf("conversation summary commit failed (%v) and its typed status could not be persisted: %w", err, attemptErr)
		}
		return err
	}
	return nil
}

func publicChatConversationSummaryTarget(anchor *publicChatAnchorState) (uint64, bool, error) {
	if anchor == nil {
		return 0, false, nil
	}
	eligible, err := publicChatEligibleCommittedTranscript(anchor.CommittedTranscript)
	if err != nil {
		return 0, false, err
	}
	if len(eligible) <= publicChatRecentVerbatimTurnLimit {
		return 0, false, nil
	}
	recentStart := eligible[len(eligible)-publicChatRecentVerbatimTurnLimit].Sequence
	if recentStart == 0 {
		return 0, false, nil
	}
	return recentStart - 1, true, nil
}

func publicChatConversationSummaryInput(anchor *publicChatAnchorState, targetEnd uint64) (string, error) {
	if anchor == nil || targetEnd >= uint64(len(anchor.CommittedTranscript)) {
		return "", fmt.Errorf("conversation summary coverage is invalid")
	}
	var builder strings.Builder
	start := uint64(0)
	if current := publicChatLastValidConversationSummary(anchor.ConversationSummary); current != nil {
		builder.WriteString("Prior sequence-bound summary:\n")
		builder.WriteString(current.Text)
		builder.WriteString("\nNew committed whole turns:\n")
		start = current.CoveredSequenceEnd + 1
	}
	if start > targetEnd {
		return "", fmt.Errorf("conversation summary coverage does not advance continuously")
	}
	for sequence := start; sequence <= targetEnd; sequence++ {
		turn := anchor.CommittedTranscript[sequence]
		userText := turn.InputText
		if userText == "" && turn.InputAttachment != nil {
			userText = publicChatTranscriptAttachmentMarker
		}
		assistantText := turn.AssistantText
		if assistantText == "" {
			assistantText = "[no assistant output was committed for this turn]"
		}
		fmt.Fprintf(&builder, "[turn %d]\nuser=%s\nassistant=%s\n", turn.Sequence, userText, assistantText)
		if builder.Len() > publicChatConversationSummaryInputMaxBytes {
			return "", fmt.Errorf("conversation summary input exceeds bounded capacity")
		}
	}
	return strings.TrimSpace(builder.String()), nil
}

func publicChatConversationSummaryAttemptStatusForError(err error) string {
	if errors.Is(err, errPublicChatConversationSummaryUnavailable) || errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return "unavailable"
	}
	switch status.Code(err) {
	case codes.Canceled, codes.DeadlineExceeded, codes.Unavailable, codes.ResourceExhausted:
		return "unavailable"
	default:
		return "failed"
	}
}

func publicChatConversationSummaryStreamFailureError(failed *runtimev1.ScenarioStreamFailed) error {
	reason := runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED
	if failed != nil {
		reason = failed.GetReasonCode()
	}
	switch reason {
	case runtimev1.ReasonCode_AI_MODEL_NOT_READY,
		runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE,
		runtimev1.ReasonCode_AI_STREAM_BROKEN,
		runtimev1.ReasonCode_AI_CONNECTOR_LIMIT_EXCEEDED,
		runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE,
		runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE,
		runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED,
		runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT,
		runtimev1.ReasonCode_AGENT_AI_CONFIG_TARGET_UNAVAILABLE,
		runtimev1.ReasonCode_AI_LOCAL_DRIVER_UNAVAILABLE:
		return fmt.Errorf("%w: conversation summary Job failed: %s", errPublicChatConversationSummaryUnavailable, reason)
	default:
		return fmt.Errorf("conversation summary Job failed: %s", reason)
	}
}

func (s *Service) executePublicChatConversationSummaryWithExecution(ctx context.Context, identity publicChatConversationSummaryIdentity, execution publicChatConversationSummaryExecution) (string, error) {
	if strings.TrimSpace(execution.Input) == "" || strings.TrimSpace(identity.OwnerUserID) == "" || strings.TrimSpace(identity.SubjectUserID) == "" || strings.TrimSpace(identity.CallerAppID) == "" {
		return "", fmt.Errorf("conversation summary execution custody is invalid")
	}
	executionCtx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	executionCtx = executionintent.WithRuntimeAccountSubject(executionCtx, identity.OwnerUserID)
	var output strings.Builder
	var failed *runtimev1.ScenarioStreamFailed
	var completed bool
	executor := s.currentPublicChatTurnExecutor()
	if _, rejecting := executor.(rejectingPublicChatTurnExecutor); rejecting {
		return "", fmt.Errorf("%w: conversation summary executor is unavailable", errPublicChatConversationSummaryUnavailable)
	}
	err := executor.StreamChatTurn(executionCtx, &PublicChatTurnExecutionRequest{
		AppID: identity.CallerAppID, SubjectUserID: identity.SubjectUserID,
		Messages:  publicChatConversationSummaryProviderMessages(execution.Input),
		MaxTokens: 512, Binding: execution.Binding,
	}, func(event *runtimev1.StreamScenarioEvent) error {
		if event == nil {
			return nil
		}
		if text := event.GetDelta().GetText().GetText(); text != "" {
			output.WriteString(text)
		}
		if event.GetFailed() != nil {
			failed = event.GetFailed()
		}
		if event.GetCompleted() != nil {
			completed = true
		}
		return nil
	})
	if err != nil {
		return "", err
	}
	if failed != nil {
		return "", publicChatConversationSummaryStreamFailureError(failed)
	}
	if !completed {
		return "", errors.New("conversation summary Job ended without completion")
	}
	text, err := parsePublicChatConversationSummaryOutput(output.String())
	if err != nil {
		return "", err
	}
	if len(text) > publicChatConversationSummaryMaxBytes {
		return "", fmt.Errorf("conversation summary output exceeds bounded contract")
	}
	return text, nil
}

func parsePublicChatConversationSummaryOutput(raw string) (string, error) {
	structured, err := parsePublicChatStructuredEnvelope(raw)
	if err != nil {
		return "", fmt.Errorf("conversation summary output invalid: %w", err)
	}
	if structured.Message.MessageID != "conversation-summary" {
		return "", fmt.Errorf("conversation summary output invalid: message id must equal conversation-summary")
	}
	if structured.StatusCue != nil || len(structured.Actions) != 0 {
		return "", fmt.Errorf("conversation summary output invalid: status cues and actions are not admitted")
	}
	text := strings.TrimSpace(structured.Message.Text)
	if text == "" {
		return "", fmt.Errorf("conversation summary output invalid: message text is required")
	}
	return text, nil
}

func (s *Service) commitPublicChatConversationSummary(anchorID string, coveredEnd uint64, text string, routeCorrelation string) error {
	s.chatSurfaceMu.Lock()
	defer s.chatSurfaceMu.Unlock()
	anchor := s.chatAnchors[strings.TrimSpace(anchorID)]
	if anchor == nil || coveredEnd >= uint64(len(anchor.CommittedTranscript)) {
		return fmt.Errorf("conversation summary commit target changed")
	}
	previous := clonePublicChatConversationSummary(anchor.ConversationSummary)
	if valid := publicChatLastValidConversationSummary(previous); valid != nil && valid.CoveredSequenceEnd >= coveredEnd {
		return nil
	}
	versionBefore := s.chatSurfaceVersion
	revision := uint64(1)
	if valid := publicChatLastValidConversationSummary(previous); valid != nil {
		revision = valid.Revision + 1
	}
	now := time.Now().UTC()
	anchor.ConversationSummary = &publicChatConversationSummaryState{
		LastValid: &publicChatConversationSummaryValidState{
			Revision: revision, CoveredSequenceStart: 0, CoveredSequenceEnd: coveredEnd,
			Text: strings.TrimSpace(text), GeneratedAt: now, RouteCorrelation: routeCorrelation,
		},
		LastAttempt: publicChatConversationSummaryAttemptState{
			Status: "ready", TargetSequenceEnd: coveredEnd, AttemptedAt: now,
		},
	}
	if err := validatePublicChatConversationSummary(anchor.ConversationSummary, anchor.CommittedTranscript); err != nil {
		anchor.ConversationSummary = previous
		return err
	}
	if err := s.persistPublicChatSurfaceStateLocked(); err != nil {
		anchor.ConversationSummary = previous
		s.chatSurfaceVersion = versionBefore
		return fmt.Errorf("%w: %v", errPublicChatConversationSummaryUnavailable, err)
	}
	return nil
}

func (s *Service) commitPublicChatConversationSummaryAttempt(anchorID string, coveredEnd uint64, attemptStatus string) error {
	if !admittedPublicChatConversationSummaryAttemptStatus(attemptStatus) || attemptStatus == "ready" {
		return fmt.Errorf("conversation summary attempt status is invalid")
	}
	s.chatSurfaceMu.Lock()
	defer s.chatSurfaceMu.Unlock()
	anchor := s.chatAnchors[strings.TrimSpace(anchorID)]
	if anchor == nil || coveredEnd >= uint64(len(anchor.CommittedTranscript)) {
		return fmt.Errorf("conversation summary attempt target changed")
	}
	previous := clonePublicChatConversationSummary(anchor.ConversationSummary)
	if valid := publicChatLastValidConversationSummary(previous); valid != nil && valid.CoveredSequenceEnd >= coveredEnd {
		return nil
	}
	versionBefore := s.chatSurfaceVersion
	next := clonePublicChatConversationSummary(previous)
	if next == nil {
		next = &publicChatConversationSummaryState{}
	}
	next.LastAttempt = publicChatConversationSummaryAttemptState{
		Status: attemptStatus, TargetSequenceEnd: coveredEnd, AttemptedAt: time.Now().UTC(),
	}
	anchor.ConversationSummary = next
	if err := validatePublicChatConversationSummary(anchor.ConversationSummary, anchor.CommittedTranscript); err != nil {
		anchor.ConversationSummary = previous
		return err
	}
	if err := s.persistPublicChatSurfaceStateLocked(); err != nil {
		// LastValid remains the previously committed durable payload, while this
		// bounded attempt is the Runtime-observed truth needed by the next turn.
		// Keep it in the existing anchor state so a continuing persistence outage
		// cannot be misprojected as ready or absent; a later successful surface
		// write will carry it durably without a second persistence truth.
		s.chatSurfaceVersion = versionBefore
		return fmt.Errorf("%w: %v", errPublicChatConversationSummaryUnavailable, err)
	}
	return nil
}

func publicChatLastValidConversationSummary(state *publicChatConversationSummaryState) *publicChatConversationSummaryValidState {
	if state == nil || state.LastValid == nil {
		return nil
	}
	return state.LastValid
}
