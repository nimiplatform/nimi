package localservice

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/rpcctx"
	"github.com/nimiplatform/nimi/runtime/internal/streamutil"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const (
	localTransferStateQueued    = "queued"
	localTransferStateRunning   = "running"
	localTransferStatePaused    = "paused"
	localTransferStateFailed    = "failed"
	localTransferStateCompleted = "completed"
	localTransferStateCancelled = "cancelled"
	localTransferStreamBudget   = 32

	localTransferKindDownload       = "download"
	localTransferKindImport         = "import"
	localTransferInterruptionReason = "LOCAL_TRANSFER_INTERRUPTED"
	localTransferCommitPendingPhase = "commit_pending"
	localTransferReimportReason     = "LOCAL_TRANSFER_REIMPORT_REQUIRED"
	localTransferSourceLabelLimit   = 160
)

var errLocalTransferCancelled = errors.New("local transfer cancelled")

type localTransferControl struct {
	mu        sync.Mutex
	paused    bool
	cancelled bool
	signal    chan struct{}
}

func newLocalTransferControl() *localTransferControl {
	return &localTransferControl{signal: make(chan struct{})}
}

func (c *localTransferControl) pause() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.cancelled || c.paused {
		return false
	}
	c.paused = true
	close(c.signal)
	c.signal = make(chan struct{})
	return true
}

func (c *localTransferControl) resume() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.cancelled || !c.paused {
		return false
	}
	c.paused = false
	close(c.signal)
	c.signal = make(chan struct{})
	return true
}

func (c *localTransferControl) isPaused() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.paused && !c.cancelled
}

func (c *localTransferControl) cancel() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.cancelled {
		return false
	}
	c.cancelled = true
	c.paused = false
	close(c.signal)
	c.signal = make(chan struct{})
	return true
}

func (c *localTransferControl) wait(ctx context.Context) error {
	for {
		c.mu.Lock()
		cancelled := c.cancelled
		paused := c.paused
		signal := c.signal
		c.mu.Unlock()
		if cancelled {
			return errLocalTransferCancelled
		}
		if !paused {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-signal:
		}
	}
}

// localTransferImportSpec is the immutable source of an import transfer.
type localTransferImportSpec struct {
	SourcePath  string `json:"sourcePath"`
	DisplayName string `json:"displayName,omitempty"`
	IsDir       bool   `json:"isDir,omitempty"`
	SizeBytes   int64  `json:"sizeBytes,omitempty"`
}

// localTransferCommitIntent is the private, durable target of an acquisition
// that has finished fetching and is about to create a view. It exists before
// the manifest and is cleared when the result commits or the intent is
// cancelled. It is never a public asset.
type localTransferCommitIntent struct {
	Kind             string                  `json:"kind"`
	ModelAssetID     string                  `json:"modelAssetId"`
	ManagedDirectory string                  `json:"managedDirectory"`
	Generation       string                  `json:"generation"`
	Entry            string                  `json:"entry"`
	Files            []modelDistributionFile `json:"files"`
}

type localTransferResult struct {
	Disposition  string `json:"disposition"`
	ModelAssetID string `json:"modelAssetId"`
}

// localTransferPrivateState holds the Runtime-private facts of a transfer
// that never appear on the public summary: its immutable import source, its
// commit intent, its durable result, the durable cancel request, and whether
// the executor may still hold staging or holds that need cleanup.
type localTransferPrivateState struct {
	importSpec      *localTransferImportSpec
	commitIntent    *localTransferCommitIntent
	result          *localTransferResult
	cancelRequested bool
}

func (s *Service) transferPrivateLocked(sessionID string) *localTransferPrivateState {
	key := strings.TrimSpace(sessionID)
	if s.transferPrivate == nil {
		s.transferPrivate = make(map[string]*localTransferPrivateState)
	}
	private := s.transferPrivate[key]
	if private == nil {
		private = &localTransferPrivateState{}
		s.transferPrivate[key] = private
	}
	return private
}

func normalizeTransferState(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case localTransferStateQueued:
		return localTransferStateQueued
	case localTransferStatePaused:
		return localTransferStatePaused
	case localTransferStateFailed:
		return localTransferStateFailed
	case localTransferStateCompleted:
		return localTransferStateCompleted
	case localTransferStateCancelled:
		return localTransferStateCancelled
	default:
		return localTransferStateRunning
	}
}

func normalizeTransferKind(value string) string {
	if strings.EqualFold(strings.TrimSpace(value), localTransferKindImport) {
		return localTransferKindImport
	}
	return localTransferKindDownload
}

func isTerminalTransferState(state string) bool {
	switch normalizeTransferState(state) {
	case localTransferStateFailed, localTransferStateCompleted, localTransferStateCancelled:
		return true
	default:
		return false
	}
}

func isRetryableFailedManagedDownload(summary *runtimev1.LocalTransferSessionSummary) bool {
	return summary != nil &&
		normalizeTransferKind(summary.GetSessionKind()) == localTransferKindDownload &&
		normalizeTransferState(summary.GetState()) == localTransferStateFailed &&
		summary.GetRetryable()
}

func transferStateDoneSuccess(state string) (bool, bool) {
	switch normalizeTransferState(state) {
	case localTransferStateCompleted:
		return true, true
	case localTransferStateFailed, localTransferStateCancelled:
		return true, false
	default:
		return false, false
	}
}

func boundedTransferSourceLabel(value string) string {
	runes := []rune(strings.TrimSpace(value))
	if len(runes) <= localTransferSourceLabelLimit {
		return string(runes)
	}
	return string(runes[:localTransferSourceLabelLimit])
}

func cloneLocalTransferSummary(summary *runtimev1.LocalTransferSessionSummary) *runtimev1.LocalTransferSessionSummary {
	if summary == nil {
		return nil
	}
	return &runtimev1.LocalTransferSessionSummary{
		InstallSessionId:        summary.GetInstallSessionId(),
		AssetId:                 summary.GetAssetId(),
		SessionKind:             normalizeTransferKind(summary.GetSessionKind()),
		Phase:                   strings.TrimSpace(summary.GetPhase()),
		State:                   normalizeTransferState(summary.GetState()),
		BytesReceived:           summary.GetBytesReceived(),
		BytesTotal:              summary.GetBytesTotal(),
		SpeedBytesPerSec:        summary.GetSpeedBytesPerSec(),
		EtaSeconds:              summary.GetEtaSeconds(),
		Message:                 strings.TrimSpace(summary.GetMessage()),
		ReasonCode:              strings.TrimSpace(summary.GetReasonCode()),
		Retryable:               summary.GetRetryable(),
		CreatedAt:               summary.GetCreatedAt(),
		UpdatedAt:               summary.GetUpdatedAt(),
		PlanId:                  strings.TrimSpace(summary.GetPlanId()),
		BytesReused:             summary.GetBytesReused(),
		BytesVerified:           summary.GetBytesVerified(),
		SourceLabel:             boundedTransferSourceLabel(summary.GetSourceLabel()),
		Disposition:             summary.GetDisposition(),
		AvailableActions:        append([]runtimev1.LocalTransferAction(nil), summary.GetAvailableActions()...),
		RelatedInstallSessionId: strings.TrimSpace(summary.GetRelatedInstallSessionId()),
		CleanupPending:          summary.GetCleanupPending(),
	}
}

func localTransferEventFromSummary(summary *runtimev1.LocalTransferSessionSummary) *runtimev1.LocalTransferProgressEvent {
	if summary == nil {
		return nil
	}
	done, success := transferStateDoneSuccess(summary.GetState())
	return &runtimev1.LocalTransferProgressEvent{
		InstallSessionId:        summary.GetInstallSessionId(),
		AssetId:                 summary.GetAssetId(),
		SessionKind:             normalizeTransferKind(summary.GetSessionKind()),
		Phase:                   strings.TrimSpace(summary.GetPhase()),
		BytesReceived:           summary.GetBytesReceived(),
		BytesTotal:              summary.GetBytesTotal(),
		SpeedBytesPerSec:        summary.GetSpeedBytesPerSec(),
		EtaSeconds:              summary.GetEtaSeconds(),
		Message:                 strings.TrimSpace(summary.GetMessage()),
		State:                   normalizeTransferState(summary.GetState()),
		ReasonCode:              strings.TrimSpace(summary.GetReasonCode()),
		Retryable:               summary.GetRetryable(),
		Done:                    done,
		Success:                 success,
		CreatedAt:               summary.GetCreatedAt(),
		UpdatedAt:               summary.GetUpdatedAt(),
		PlanId:                  strings.TrimSpace(summary.GetPlanId()),
		BytesReused:             summary.GetBytesReused(),
		BytesVerified:           summary.GetBytesVerified(),
		SourceLabel:             boundedTransferSourceLabel(summary.GetSourceLabel()),
		Disposition:             summary.GetDisposition(),
		AvailableActions:        append([]runtimev1.LocalTransferAction(nil), summary.GetAvailableActions()...),
		RelatedInstallSessionId: strings.TrimSpace(summary.GetRelatedInstallSessionId()),
		CleanupPending:          summary.GetCleanupPending(),
	}
}

// projectTransferActionsLocked derives the typed available actions from the
// Runtime's own state: whether an executor is alive, the kind, the phase, the
// terminal classification, and outstanding cleanup. Consumers never infer
// these from paused/retryable alone. Caller holds s.mu.
func (s *Service) projectTransferActionsLocked(summary *runtimev1.LocalTransferSessionSummary) []runtimev1.LocalTransferAction {
	if summary == nil {
		return nil
	}
	key := summary.GetInstallSessionId()
	state := normalizeTransferState(summary.GetState())
	kind := normalizeTransferKind(summary.GetSessionKind())
	control := s.transferControls[key]
	actions := make([]runtimev1.LocalTransferAction, 0, 3)
	if strings.TrimSpace(summary.GetRelatedInstallSessionId()) != "" {
		actions = append(actions, runtimev1.LocalTransferAction_LOCAL_TRANSFER_ACTION_VIEW_RELATED_TRANSFER)
	}
	switch state {
	case localTransferStateQueued, localTransferStateRunning:
		if control != nil {
			actions = append(actions, runtimev1.LocalTransferAction_LOCAL_TRANSFER_ACTION_PAUSE)
		}
		actions = append(actions, runtimev1.LocalTransferAction_LOCAL_TRANSFER_ACTION_CANCEL)
	case localTransferStatePaused:
		switch {
		case summary.GetPhase() == localTransferCommitPendingPhase:
			actions = append(actions, runtimev1.LocalTransferAction_LOCAL_TRANSFER_ACTION_CHECK_SYNC, runtimev1.LocalTransferAction_LOCAL_TRANSFER_ACTION_CANCEL)
		case kind == localTransferKindDownload || control != nil:
			actions = append(actions, runtimev1.LocalTransferAction_LOCAL_TRANSFER_ACTION_RESUME, runtimev1.LocalTransferAction_LOCAL_TRANSFER_ACTION_CANCEL)
		default:
			actions = append(actions, runtimev1.LocalTransferAction_LOCAL_TRANSFER_ACTION_CANCEL)
		}
	case localTransferStateFailed:
		if kind == localTransferKindDownload && summary.GetRetryable() {
			actions = append(actions, runtimev1.LocalTransferAction_LOCAL_TRANSFER_ACTION_RESUME, runtimev1.LocalTransferAction_LOCAL_TRANSFER_ACTION_CANCEL)
		} else if kind == localTransferKindImport {
			actions = append(actions, runtimev1.LocalTransferAction_LOCAL_TRANSFER_ACTION_REIMPORT)
		}
		if summary.GetCleanupPending() {
			actions = appendUniqueTransferAction(actions, runtimev1.LocalTransferAction_LOCAL_TRANSFER_ACTION_CANCEL)
		}
	case localTransferStateCancelled:
		if summary.GetCleanupPending() {
			actions = append(actions, runtimev1.LocalTransferAction_LOCAL_TRANSFER_ACTION_CANCEL)
		}
	}
	return actions
}

func appendUniqueTransferAction(actions []runtimev1.LocalTransferAction, action runtimev1.LocalTransferAction) []runtimev1.LocalTransferAction {
	for _, existing := range actions {
		if existing == action {
			return actions
		}
	}
	return append(actions, action)
}

// projectedTransferSummaryLocked returns the public summary with the current
// action projection applied. Caller holds s.mu.
func (s *Service) projectedTransferSummaryLocked(summary *runtimev1.LocalTransferSessionSummary) *runtimev1.LocalTransferSessionSummary {
	projected := cloneLocalTransferSummary(summary)
	if projected == nil {
		return nil
	}
	projected.AvailableActions = s.projectTransferActionsLocked(projected)
	return projected
}

func (s *Service) newManagedModelDownloadTransfer(input localTransferMutation, spec managedDownloadedModelSpec) (*runtimev1.LocalTransferSessionSummary, error) {
	return s.createLocalTransfer(localTransferKindDownload, input, &spec, nil, true)
}

func (s *Service) createLocalTransfer(
	kind string,
	input localTransferMutation,
	downloadSpec *managedDownloadedModelSpec,
	importSpec *localTransferImportSpec,
	requireDurable bool,
) (*runtimev1.LocalTransferSessionSummary, error) {
	now := nowISO()
	summary := &runtimev1.LocalTransferSessionSummary{
		InstallSessionId: "transfer_" + strings.ToLower(ulid.Make().String()),
		SessionKind:      normalizeTransferKind(kind),
		Phase:            defaultString(strings.TrimSpace(input.Phase), "download"),
		State:            normalizeTransferState(defaultString(strings.TrimSpace(input.State), localTransferStateRunning)),
		BytesReceived:    clampInt64Minimum(input.BytesReceived, 0),
		BytesTotal:       clampInt64Minimum(input.BytesTotal, 0),
		SpeedBytesPerSec: clampInt64Minimum(input.SpeedBytesPerSec, 0),
		EtaSeconds:       clampInt64Minimum(input.EtaSeconds, 0),
		Message:          strings.TrimSpace(input.Message),
		ReasonCode:       strings.TrimSpace(input.ReasonCode),
		Retryable:        input.Retryable,
		CreatedAt:        now,
		UpdatedAt:        now,
		PlanId:           strings.TrimSpace(input.PlanID),
		SourceLabel:      boundedTransferSourceLabel(defaultString(strings.TrimSpace(input.SourceLabel), strings.TrimSpace(input.ModelID))),
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	key := summary.GetInstallSessionId()
	s.transfers[key] = cloneLocalTransferSummary(summary)
	if downloadSpec != nil {
		s.managedModelDownloadSpecs[key] = cloneManagedDownloadedModelSpec(*downloadSpec)
	}
	private := s.transferPrivateLocked(key)
	if importSpec != nil {
		copied := *importSpec
		private.importSpec = &copied
	}
	if !isTerminalTransferState(summary.GetState()) {
		// Every non-terminal transfer gets a control. Import and download sessions
		// both honor pause, resume, and cancellation through the same bounded path.
		s.transferControls[key] = newLocalTransferControl()
	}
	if err := s.persistStateLocked(); err != nil && requireDurable {
		delete(s.transfers, key)
		delete(s.managedModelDownloadSpecs, key)
		delete(s.transferControls, key)
		delete(s.transferPrivate, key)
		return nil, fmt.Errorf("persist transfer: %w", err)
	}
	projected := s.projectedTransferSummaryLocked(summary)
	s.publishTransferEventLocked(localTransferEventFromSummary(projected))
	return projected, nil
}

type localTransferMutation struct {
	// ModelID is only a bounded source label alias (catalog model id or import
	// name) used by callers that have no separate display label. It is never
	// an asset identity and never lands in asset_id.
	ModelID          string
	Phase            string
	State            string
	BytesReceived    int64
	BytesTotal       int64
	SpeedBytesPerSec int64
	EtaSeconds       int64
	Message          string
	ReasonCode       string
	Retryable        bool
	PlanID           string
	SourceLabel      string
}

func (s *Service) mutateLocalTransfer(sessionID string, persist bool, mutate func(summary *runtimev1.LocalTransferSessionSummary)) (*runtimev1.LocalTransferSessionSummary, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	key := strings.TrimSpace(sessionID)
	previous := cloneLocalTransferSummary(s.transfers[key])
	current := cloneLocalTransferSummary(previous)
	if current == nil {
		return nil, nil
	}
	previousControl, hadControl := s.transferControls[key]
	previousRate, hadRate := s.transferRates[key]
	previousSpec, hadSpec := s.managedModelDownloadSpecs[key]
	mutate(current)
	current.InstallSessionId = previous.GetInstallSessionId()
	current.SessionKind = normalizeTransferKind(current.GetSessionKind())
	current.State = normalizeTransferState(current.GetState())
	current.SourceLabel = previous.GetSourceLabel()
	if isTerminalTransferState(current.GetState()) {
		current.SpeedBytesPerSec = 0
		current.EtaSeconds = 0
	}
	current.UpdatedAt = nowISO()
	s.transfers[key] = cloneLocalTransferSummary(current)
	if isTerminalTransferState(current.GetState()) {
		delete(s.transferControls, key)
		delete(s.transferRates, key)
		if !isRetryableFailedManagedDownload(current) {
			delete(s.managedModelDownloadSpecs, key)
		}
	}
	if persist {
		if err := s.persistStateLocked(); err != nil {
			s.transfers[key] = previous
			if hadControl {
				s.transferControls[key] = previousControl
			} else {
				delete(s.transferControls, key)
			}
			if hadRate {
				s.transferRates[key] = previousRate
			} else {
				delete(s.transferRates, key)
			}
			if hadSpec {
				s.managedModelDownloadSpecs[key] = cloneManagedDownloadedModelSpec(previousSpec)
			} else {
				delete(s.managedModelDownloadSpecs, key)
			}
			return s.projectedTransferSummaryLocked(previous), err
		}
	}
	projected := s.projectedTransferSummaryLocked(current)
	s.publishTransferEventLocked(localTransferEventFromSummary(projected))
	return projected, nil
}

func localTransferPersistenceError(err error) error {
	return grpcerr.WrapWithReasonCode(
		codes.Unavailable,
		runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_PERSISTENCE_UNAVAILABLE,
		err,
		grpcerr.ReasonOptions{Message: "local transfer state could not be persisted"},
	)
}

// @nimi-authority: rule.nimi.runtime.local-compute.r029
// reconcileOrphanedLocalTransfersLocked classifies every non-terminal
// transfer after a daemon restart. Downloads keep their transfer-owned prefix
// and pause for an explicit resume. An import whose source was not fully
// taken over ends failed and non-retryable (the source must be imported
// again); an import that already holds a complete uncommitted view becomes
// paused in commit_pending and is finished or cancelled explicitly. Commit
// intents that already reached inventory are settled by
// reconcileTransferCommitIntents once the inventory owner is available.
// Caller must hold s.mu.
func (s *Service) reconcileOrphanedLocalTransfersLocked(modelsRoot string) int {
	healed := 0
	for _, summary := range s.transfers {
		if summary == nil || isTerminalTransferState(summary.GetState()) {
			continue
		}
		state := normalizeTransferState(summary.GetState())
		changed := false
		private := s.transferPrivateLocked(summary.GetInstallSessionId())
		if normalizeTransferKind(summary.GetSessionKind()) == localTransferKindDownload {
			// Progress events are intentionally not fsynced on every chunk. Rebuild
			// the durable byte projection from the transfer's own staging so a hard
			// restart never presents an existing Range prefix as 0 B or shares it.
			var files []string
			if spec, exists := s.managedModelDownloadSpecs[summary.GetInstallSessionId()]; exists {
				files = managedModelDownloadStagingFiles(spec)
			}
			if bytesReceived, err := managedModelDownloadStagedBytes(modelsRoot, summary.GetInstallSessionId(), files); err == nil &&
				summary.GetBytesReceived() != bytesReceived {
				summary.BytesReceived = bytesReceived
				changed = true
			}
			if state == localTransferStateRunning || state == localTransferStateQueued {
				summary.State = localTransferStatePaused
				summary.Message = "transfer interrupted by runtime restart"
				summary.ReasonCode = localTransferInterruptionReason
				summary.Retryable = true
				changed = true
			}
		} else if private.commitIntent != nil && private.commitIntent.Kind == "create" {
			if state != localTransferStatePaused || summary.GetPhase() != localTransferCommitPendingPhase {
				summary.State = localTransferStatePaused
				summary.Phase = localTransferCommitPendingPhase
				summary.Message = "managed view is complete; run Check & Sync to commit or cancel to discard"
				summary.ReasonCode = localTransferInterruptionReason
				summary.Retryable = false
				changed = true
			}
		} else {
			summary.State = localTransferStateFailed
			summary.Message = "import interrupted before its source was taken over; import the source again"
			summary.ReasonCode = localTransferReimportReason
			summary.Retryable = false
			summary.CleanupPending = true
			changed = true
		}
		if !changed {
			continue
		}
		summary.SpeedBytesPerSec = 0
		summary.EtaSeconds = 0
		summary.UpdatedAt = nowISO()
		healed++
	}
	return healed
}

// reconcileTransferCommitIntents settles intents against the recovered
// inventory: an intent whose target is committed with the same generation
// becomes a created result; an intent whose target is absent keeps waiting
// for its explicit resume, Check & Sync, or cancel; a cancelled intent's
// material is discarded. It runs before reclamation opens.
func (s *Service) reconcileTransferCommitIntents() {
	s.lockModelAssetMutation()
	defer s.modelAssetMutationMu.Unlock()
	s.mu.Lock()
	defer s.mu.Unlock()
	changed := false
	clearedIntents := make(map[string]*localTransferCommitIntent)
	for key, private := range s.transferPrivate {
		summary := s.transfers[key]
		if summary == nil {
			continue
		}
		if private.commitIntent != nil {
			intent := private.commitIntent
			if asset := s.modelAssets[intent.ModelAssetID]; asset != nil && strings.TrimSpace(asset.GetCreatedAt()) == strings.TrimSpace(intent.Generation) {
				// Inventory committed before the transfer result was durable.
				if !isTerminalTransferState(summary.GetState()) || normalizeTransferState(summary.GetState()) != localTransferStateCompleted {
					summary.State = localTransferStateCompleted
					summary.Phase = "register"
					summary.Message = "ModelAsset installed"
					summary.ReasonCode = ""
					summary.Retryable = false
					summary.AssetId = intent.ModelAssetID
					summary.Disposition = runtimev1.LocalTransferDisposition_LOCAL_TRANSFER_DISPOSITION_CREATED
					summary.BytesTotal = asset.GetTotalSizeBytes()
					summary.UpdatedAt = nowISO()
					delete(s.transferControls, key)
					delete(s.managedModelDownloadSpecs, key)
				}
				clearedIntents[key] = private.commitIntent
				private.commitIntent = nil
				private.result = &localTransferResult{Disposition: "created", ModelAssetID: intent.ModelAssetID}
				changed = true
				continue
			}
			if private.cancelRequested {
				// Keep the cleanup target durable until the view is really gone.
				summary.CleanupPending = true
				changed = true
				continue
			}
		}
		if private.result != nil && normalizeTransferState(summary.GetState()) != localTransferStateCompleted && !private.cancelRequested {
			summary.State = localTransferStateCompleted
			summary.AssetId = private.result.ModelAssetID
			if private.result.Disposition == "reused" {
				summary.Disposition = runtimev1.LocalTransferDisposition_LOCAL_TRANSFER_DISPOSITION_REUSED
			} else {
				summary.Disposition = runtimev1.LocalTransferDisposition_LOCAL_TRANSFER_DISPOSITION_CREATED
			}
			summary.ReasonCode = ""
			summary.Retryable = false
			summary.UpdatedAt = nowISO()
			delete(s.transferControls, key)
			delete(s.managedModelDownloadSpecs, key)
			changed = true
		}
	}
	if changed {
		if err := s.persistStateLocked(); err != nil {
			for key, intent := range clearedIntents {
				s.transferPrivate[key].commitIntent = intent
			}
			s.logger.Warn("persist reconciled transfer results failed", "error", err)
		}
	}
	// Terminal transfers without outstanding cleanup keep no holds.
	for key, summary := range s.transfers {
		if summary != nil && isTerminalTransferState(summary.GetState()) && !isRetryableFailedManagedDownload(summary) && !summary.GetCleanupPending() {
			s.releaseModelObjectHolds(key)
		}
	}
}

// transferCommitIntentsLocked lists the durable create intents of transfers
// that are neither cancelled nor completed; their files are live roots.
func (s *Service) transferCommitIntentsLocked() []*localTransferCommitIntent {
	intents := make([]*localTransferCommitIntent, 0)
	for key, private := range s.transferPrivate {
		if private.commitIntent == nil || private.cancelRequested {
			continue
		}
		if summary := s.transfers[key]; summary != nil && normalizeTransferState(summary.GetState()) == localTransferStateCancelled {
			continue
		}
		intents = append(intents, private.commitIntent)
	}
	return intents
}

// transferPinsAssetLocked reports whether an uncommitted reuse verification
// or a create intent still targets the asset. Caller may hold s.mu read.
func (s *Service) transferPinsAssetLocked(modelAssetID string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, private := range s.transferPrivate {
		if private.commitIntent != nil && private.commitIntent.ModelAssetID == modelAssetID && !private.cancelRequested {
			return true
		}
	}
	return false
}

// settledTransferResults captures the staged completions and previous
// private states changed during result settlement. Rollback is only for a
// failed result save; a later removal failure cannot undo a durable result.
type settledTransferResults struct {
	completions []*stagedTransferCompletion
	previous    map[string]localTransferPrivateState
	summaries   map[string]*runtimev1.LocalTransferSessionSummary
}

func (settled *settledTransferResults) rollbackLocked(s *Service) {
	if settled == nil {
		return
	}
	for index := len(settled.completions) - 1; index >= 0; index-- {
		settled.completions[index].rollbackLocked(s)
	}
	for key, previous := range settled.previous {
		copied := previous
		s.transferPrivate[key] = &copied
	}
	for key, summary := range settled.summaries {
		s.transfers[key] = cloneLocalTransferSummary(summary)
	}
}

// settlePendingTransferResultsForAssetLocked resolves, inside the removal's
// metadata boundary, every transfer whose pending result targets the asset:
// a committed create intent with the asset's generation is annotated as
// created; any other intent targeting the asset ends as failed (the asset is
// no longer available). The settlement is persisted before the inventory
// changes; a persistence failure refuses the removal. Caller holds
// modelAssetMutationMu and s.mu.
func (s *Service) settlePendingTransferResultsForAssetLocked(modelAssetID string, generation string) (*settledTransferResults, error) {
	settled := &settledTransferResults{previous: make(map[string]localTransferPrivateState), summaries: make(map[string]*runtimev1.LocalTransferSessionSummary)}
	changed := false
	for key, private := range s.transferPrivate {
		if private.commitIntent == nil || private.commitIntent.ModelAssetID != modelAssetID {
			continue
		}
		summary := s.transfers[key]
		if summary == nil {
			continue
		}
		settled.previous[key] = *private
		settled.summaries[key] = cloneLocalTransferSummary(summary)
		if private.commitIntent.Kind == "create" && strings.TrimSpace(private.commitIntent.Generation) == strings.TrimSpace(generation) {
			staged := s.stageTransferCompletionLocked(key, "register", "ModelAsset installed", func(current *runtimev1.LocalTransferSessionSummary) {
				current.AssetId = modelAssetID
				current.Disposition = runtimev1.LocalTransferDisposition_LOCAL_TRANSFER_DISPOSITION_CREATED
			})
			if staged != nil && staged.changed {
				settled.completions = append(settled.completions, staged)
			}
			private.result = &localTransferResult{Disposition: "created", ModelAssetID: modelAssetID}
		} else {
			summary.State = localTransferStateFailed
			summary.Message = "the ModelAsset targeted by this acquisition was removed before its result committed"
			summary.ReasonCode = runtimev1.ReasonCode_AI_LOCAL_ASSET_NOT_FOUND.String()
			summary.Retryable = false
			summary.UpdatedAt = nowISO()
			delete(s.transferControls, key)
			delete(s.managedModelDownloadSpecs, key)
		}
		private.commitIntent = nil
		changed = true
	}
	if !changed {
		return settled, nil
	}
	if err := s.persistStateLocked(); err != nil {
		settled.rollbackLocked(s)
		return nil, err
	}
	return settled, nil
}

// persistTransferCommitIntent makes the private create target durable before
// any view material exists.
func (s *Service) persistTransferCommitIntent(sessionID string, intent *localTransferCommitIntent) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	private := s.transferPrivateLocked(sessionID)
	if private.cancelRequested {
		return errLocalTransferCancelled
	}
	previous := private.commitIntent
	private.commitIntent = intent
	if err := s.persistStateLocked(); err != nil {
		private.commitIntent = previous
		return localTransferPersistenceError(err)
	}
	return nil
}

func (s *Service) setTransferCleanupPending(sessionID string, pending bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	key := strings.TrimSpace(sessionID)
	summary := s.transfers[key]
	if summary == nil || summary.GetCleanupPending() == pending {
		return
	}
	summary.CleanupPending = pending
	summary.UpdatedAt = nowISO()
	if err := s.persistStateLocked(); err != nil {
		s.logger.Warn("persist transfer cleanup state failed", "transfer_id", key, "error", err)
	}
	s.publishTransferEventLocked(localTransferEventFromSummary(s.projectedTransferSummaryLocked(summary)))
}

func (s *Service) transferControl(sessionID string) *localTransferControl {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.transferControls[strings.TrimSpace(sessionID)]
}

// localTransferSummary returns a clone of the current transfer summary for a
// session, or an empty summary when the session is unknown.
func (s *Service) localTransferSummary(sessionID string) *runtimev1.LocalTransferSessionSummary {
	s.mu.RLock()
	defer s.mu.RUnlock()
	summary := s.transfers[strings.TrimSpace(sessionID)]
	if summary == nil {
		return &runtimev1.LocalTransferSessionSummary{}
	}
	return s.projectedTransferSummaryLocked(summary)
}

func (s *Service) listLocalTransferSummariesLocked() []*runtimev1.LocalTransferSessionSummary {
	items := make([]*runtimev1.LocalTransferSessionSummary, 0, len(s.transfers))
	for _, summary := range s.transfers {
		items = append(items, s.projectedTransferSummaryLocked(summary))
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].GetUpdatedAt() != items[j].GetUpdatedAt() {
			return items[i].GetUpdatedAt() > items[j].GetUpdatedAt()
		}
		return items[i].GetInstallSessionId() > items[j].GetInstallSessionId()
	})
	return items
}

func (s *Service) publishTransferEventLocked(event *runtimev1.LocalTransferProgressEvent) {
	if event == nil {
		return
	}
	for subscriberID, ch := range s.transferSubscribers {
		clone := localTransferEventFromSummary(&runtimev1.LocalTransferSessionSummary{
			InstallSessionId:        event.GetInstallSessionId(),
			AssetId:                 event.GetAssetId(),
			SessionKind:             event.GetSessionKind(),
			Phase:                   event.GetPhase(),
			State:                   event.GetState(),
			BytesReceived:           event.GetBytesReceived(),
			BytesTotal:              event.GetBytesTotal(),
			SpeedBytesPerSec:        event.GetSpeedBytesPerSec(),
			EtaSeconds:              event.GetEtaSeconds(),
			Message:                 event.GetMessage(),
			ReasonCode:              event.GetReasonCode(),
			Retryable:               event.GetRetryable(),
			CreatedAt:               event.GetCreatedAt(),
			UpdatedAt:               event.GetUpdatedAt(),
			PlanId:                  event.GetPlanId(),
			BytesReused:             event.GetBytesReused(),
			BytesVerified:           event.GetBytesVerified(),
			SourceLabel:             event.GetSourceLabel(),
			Disposition:             event.GetDisposition(),
			AvailableActions:        append([]runtimev1.LocalTransferAction(nil), event.GetAvailableActions()...),
			RelatedInstallSessionId: event.GetRelatedInstallSessionId(),
			CleanupPending:          event.GetCleanupPending(),
		})
		select {
		case ch <- clone:
		default:
			close(ch)
			delete(s.transferSubscribers, subscriberID)
		}
	}
}

func (s *Service) addTransferSubscriberLocked() (uint64, chan *runtimev1.LocalTransferProgressEvent) {
	s.transferSubscriberSeq++
	id := s.transferSubscriberSeq
	ch := make(chan *runtimev1.LocalTransferProgressEvent, localTransferStreamBudget)
	s.transferSubscribers[id] = ch
	return id, ch
}

func (s *Service) removeTransferSubscriber(id uint64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	ch, ok := s.transferSubscribers[id]
	if !ok {
		return
	}
	delete(s.transferSubscribers, id)
	close(ch)
}

func (s *Service) ListLocalTransfers(_ context.Context, _ *runtimev1.ListLocalTransfersRequest) (*runtimev1.ListLocalTransfersResponse, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return &runtimev1.ListLocalTransfersResponse{
		Transfers: s.listLocalTransferSummariesLocked(),
	}, nil
}

func (s *Service) PauseLocalTransfer(_ context.Context, req *runtimev1.PauseLocalTransferRequest) (*runtimev1.PauseLocalTransferResponse, error) {
	sessionID := strings.TrimSpace(req.GetInstallSessionId())
	if sessionID == "" {
		return nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, grpcerr.ReasonOptions{
			Message: "installSessionId required",
		})
	}
	control := s.transferControl(sessionID)
	summary, persistErr := s.mutateLocalTransfer(sessionID, true, func(summary *runtimev1.LocalTransferSessionSummary) {
		if isTerminalTransferState(summary.GetState()) {
			return
		}
		summary.State = localTransferStatePaused
		summary.Message = "transfer paused"
		summary.SpeedBytesPerSec = 0
		summary.EtaSeconds = 0
		delete(s.transferRates, sessionID)
	})
	if persistErr != nil {
		return nil, localTransferPersistenceError(persistErr)
	}
	if summary == nil {
		return nil, grpcerr.WithReasonCodeOptions(codes.NotFound, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, grpcerr.ReasonOptions{
			Message: "transfer not found",
		})
	}
	if control == nil || isTerminalTransferState(summary.GetState()) {
		return &runtimev1.PauseLocalTransferResponse{Transfer: summary}, nil
	}
	_ = control.pause()
	return &runtimev1.PauseLocalTransferResponse{Transfer: summary}, nil
}

// @nimi-authority: rule.nimi.runtime.local-compute.r029
func (s *Service) ResumeLocalTransfer(_ context.Context, req *runtimev1.ResumeLocalTransferRequest) (*runtimev1.ResumeLocalTransferResponse, error) {
	sessionID := strings.TrimSpace(req.GetInstallSessionId())
	if sessionID == "" {
		return nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, grpcerr.ReasonOptions{
			Message: "installSessionId required",
		})
	}

	summary := s.localTransferSummary(sessionID)
	if summary.GetInstallSessionId() == "" {
		return nil, grpcerr.WithReasonCodeOptions(codes.NotFound, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, grpcerr.ReasonOptions{
			Message: "transfer not found",
		})
	}
	if isTerminalTransferState(summary.GetState()) && !isRetryableFailedManagedDownload(summary) {
		return &runtimev1.ResumeLocalTransferResponse{Transfer: summary}, nil
	}

	control := s.transferControl(sessionID)
	state := normalizeTransferState(summary.GetState())
	if state == localTransferStateRunning && control != nil {
		// Idempotent resume while the original in-process executor is alive.
		return &runtimev1.ResumeLocalTransferResponse{Transfer: summary}, nil
	}
	if state == localTransferStatePaused && control != nil && control.isPaused() {
		// A cooperative pause retains its executor and only needs the existing
		// control released. An interruption does not pause the control, so it
		// deliberately falls through to full reconstruction below.
		var persistErr error
		summary, persistErr = s.mutateLocalTransfer(sessionID, true, func(summary *runtimev1.LocalTransferSessionSummary) {
			if isTerminalTransferState(summary.GetState()) {
				return
			}
			summary.State = localTransferStateRunning
			summary.Message = "transfer resumed"
			summary.ReasonCode = ""
			summary.Retryable = true
			summary.SpeedBytesPerSec = 0
			summary.EtaSeconds = 0
		})
		if persistErr != nil {
			return nil, localTransferPersistenceError(persistErr)
		}
		_ = control.resume()
		return &runtimev1.ResumeLocalTransferResponse{Transfer: summary}, nil
	}

	if normalizeTransferKind(summary.GetSessionKind()) != localTransferKindDownload {
		// An import executor cannot be rebuilt: its source handle is gone. A
		// complete uncommitted view is committed through Check & Sync; anything
		// else is imported again.
		if summary.GetPhase() == localTransferCommitPendingPhase {
			return nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_INVALID_TRANSITION, grpcerr.ReasonOptions{
				Message: "the import holds a complete managed view; run Check & Sync to commit it or cancel to discard it", ActionHint: "run_product_control_check_sync",
			})
		}
		reason := localTransferReimportReason
		err := grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_INVALID_TRANSITION, grpcerr.ReasonOptions{
			Message: "import executor did not survive the runtime restart; import the source again", ActionHint: "reimport_model_asset",
		})
		s.discardAcquisitionMaterial(sessionID)
		if persistErr := s.failTransferWithReason(sessionID, err.Error(), reason, false); persistErr != nil {
			return nil, localTransferPersistenceError(persistErr)
		}
		return nil, err
	}

	plan, reason, err := s.rebuildManagedModelDownloadResumePlan(summary.GetInstallSessionId())
	if err != nil {
		if persistErr := s.failTransferWithReason(sessionID, err.Error(), reason, false); persistErr != nil {
			return nil, localTransferPersistenceError(persistErr)
		}
		return nil, err
	}
	resumed, err := s.startRestoredManagedModelDownload(sessionID, plan)
	if err != nil {
		if persistErr := s.failTransferWithReason(sessionID, err.Error(), runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE.String(), false); persistErr != nil {
			return nil, localTransferPersistenceError(persistErr)
		}
		return nil, err
	}
	return &runtimev1.ResumeLocalTransferResponse{Transfer: resumed}, nil
}

func (s *Service) startRestoredManagedModelDownload(
	sessionID string,
	plan managedModelDownloadResumePlan,
) (*runtimev1.LocalTransferSessionSummary, error) {
	s.mu.Lock()
	current := s.transfers[strings.TrimSpace(sessionID)]
	if current == nil {
		s.mu.Unlock()
		return nil, grpcerr.WithReasonCodeOptions(codes.NotFound, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, grpcerr.ReasonOptions{
			Message: "transfer not found",
		})
	}
	if isTerminalTransferState(current.GetState()) && !isRetryableFailedManagedDownload(current) {
		summary := s.projectedTransferSummaryLocked(current)
		s.mu.Unlock()
		return summary, nil
	}
	if normalizeTransferState(current.GetState()) == localTransferStateRunning && s.transferControls[sessionID] != nil {
		summary := s.projectedTransferSummaryLocked(current)
		s.mu.Unlock()
		return summary, nil
	}
	parent := s.jobLifetimeCtx
	if parent == nil || s.jobLifetimeCancel == nil {
		s.mu.Unlock()
		return nil, grpcerr.WithReasonCodeOptions(codes.Unavailable, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
			Message: "runtime is shutting down; transfer executor cannot be started",
		})
	}

	control := newLocalTransferControl()
	previousControl, hadControl := s.transferControls[sessionID]
	previous := cloneLocalTransferSummary(current)
	s.transferControls[sessionID] = control
	current.State = localTransferStateRunning
	current.Phase = "download"
	current.BytesReceived = clampInt64Minimum(plan.bytesReceived, 0)
	if plan.bytesTotal > 0 {
		current.BytesTotal = plan.bytesTotal
	}
	current.SpeedBytesPerSec = 0
	current.EtaSeconds = 0
	current.Message = "transfer resumed"
	current.ReasonCode = ""
	current.Retryable = true
	current.CleanupPending = false
	current.UpdatedAt = nowISO()
	s.transfers[sessionID] = cloneLocalTransferSummary(current)
	if err := s.persistStateLocked(); err != nil {
		s.transfers[sessionID] = previous
		if hadControl {
			s.transferControls[sessionID] = previousControl
		} else {
			delete(s.transferControls, sessionID)
		}
		s.mu.Unlock()
		return nil, localTransferPersistenceError(err)
	}
	summary := s.projectedTransferSummaryLocked(current)
	s.publishTransferEventLocked(localTransferEventFromSummary(summary))
	s.transferWorkerWG.Add(1)
	s.mu.Unlock()

	go func() {
		defer s.transferWorkerWG.Done()
		_, _, runErr := s.installManagedDownloadedModelWithTransfer(parent, plan.spec, sessionID)
		if runErr != nil {
			s.logger.Debug("restored managed model transfer ended with error",
				"install_session_id", sessionID,
				"error", runErr)
		}
	}()
	return summary, nil
}

// finishManagedModelDownloadExecutor drops only the executor generation that
// just exited. If an unexpected early return left its session running, it also
// fails that session closed so no running-without-executor state can persist.
func (s *Service) finishManagedModelDownloadExecutor(sessionID string, control *localTransferControl, runErr error) {
	// The executor generation is gone: nothing of this transfer writes any
	// digest any more, whatever terminal or paused state it settles into.
	s.releaseModelObjectWriters(sessionID)
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.transferControls[sessionID] != control {
		return
	}
	delete(s.transferControls, sessionID)
	previous := cloneLocalTransferSummary(s.transfers[sessionID])
	current := cloneLocalTransferSummary(previous)
	if current == nil || isTerminalTransferState(current.GetState()) || normalizeTransferState(current.GetState()) == localTransferStatePaused {
		return
	}
	previousRate, hadRate := s.transferRates[sessionID]
	previousSpec, hadSpec := s.managedModelDownloadSpecs[sessionID]
	current.State = localTransferStateFailed
	if runErr != nil {
		current.Message = runErr.Error()
	} else {
		current.Message = "transfer executor stopped before completion"
	}
	current.ReasonCode = "LOCAL_TRANSFER_FAILED"
	current.Retryable = false
	current.SpeedBytesPerSec = 0
	current.EtaSeconds = 0
	current.UpdatedAt = nowISO()
	s.transfers[sessionID] = cloneLocalTransferSummary(current)
	delete(s.transferRates, sessionID)
	delete(s.managedModelDownloadSpecs, sessionID)
	if err := s.persistStateLocked(); err != nil {
		s.transfers[sessionID] = previous
		if hadRate {
			s.transferRates[sessionID] = previousRate
		}
		if hadSpec {
			s.managedModelDownloadSpecs[sessionID] = cloneManagedDownloadedModelSpec(previousSpec)
		}
		return
	}
	s.publishTransferEventLocked(localTransferEventFromSummary(s.projectedTransferSummaryLocked(current)))
}

func (s *Service) failTransferWithReason(sessionID string, message string, reason string, retryable bool) error {
	_, err := s.mutateLocalTransfer(sessionID, true, func(summary *runtimev1.LocalTransferSessionSummary) {
		if isTerminalTransferState(summary.GetState()) {
			return
		}
		summary.State = localTransferStateFailed
		summary.Message = strings.TrimSpace(message)
		summary.ReasonCode = strings.TrimSpace(reason)
		summary.Retryable = retryable
		summary.SpeedBytesPerSec = 0
		summary.EtaSeconds = 0
	})
	return err
}

// failTransferWithConflict ends an acquisition that needs content another
// transfer owns. The related transfer is carried as typed guidance; this
// transfer is never resumable and never creates a second prefix.
func (s *Service) failTransferWithConflict(sessionID string, conflict *modelObjectConflict) error {
	reason := runtimev1.ReasonCode_AI_LOCAL_TRANSFER_IN_PROGRESS.String()
	if conflict.Kind == modelObjectConflictResumeRequired {
		reason = runtimev1.ReasonCode_AI_LOCAL_TRANSFER_RESUME_REQUIRED.String()
	}
	_, err := s.mutateLocalTransfer(sessionID, true, func(summary *runtimev1.LocalTransferSessionSummary) {
		if isTerminalTransferState(summary.GetState()) {
			return
		}
		summary.State = localTransferStateFailed
		summary.Message = conflict.Error()
		summary.ReasonCode = reason
		summary.Retryable = false
		summary.RelatedInstallSessionId = conflict.RelatedTransferID
		summary.SpeedBytesPerSec = 0
		summary.EtaSeconds = 0
	})
	return err
}

func modelObjectConflictRPCError(conflict *modelObjectConflict) error {
	metadata := map[string]string{"install_session_id": conflict.RelatedTransferID, "digest": conflict.Digest}
	if conflict.Kind == modelObjectConflictResumeRequired {
		return grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_TRANSFER_RESUME_REQUIRED, conflict, grpcerr.ReasonOptions{
			Message: "a paused or failed transfer already holds a resumable prefix of this content; resume that transfer", ActionHint: "resume_related_transfer", Metadata: metadata,
		})
	}
	return grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_TRANSFER_IN_PROGRESS, conflict, grpcerr.ReasonOptions{
		Message: "another transfer is already acquiring this content; view that transfer and retry after it finishes", ActionHint: "view_related_transfer", Metadata: metadata,
	})
}

// newLocalTransfer creates a non-durable transfer row for in-process
// callers and tests; production acquisitions use the durable constructors.
func (s *Service) newLocalTransfer(kind string, input localTransferMutation) *runtimev1.LocalTransferSessionSummary {
	summary, _ := s.createLocalTransfer(kind, input, nil, nil, false)
	return summary
}

// CancelLocalTransfer persists the cancel request first so no later commit
// can win, then stops the executor when one is alive; the transfer reports
// cancelled with cleanup pending until the executor discards its own
// material. An executor-less transfer's exclusive material is discarded here,
// with cleanup_pending kept when a file is still busy so a repeated cancel
// retries it.
func (s *Service) CancelLocalTransfer(_ context.Context, req *runtimev1.CancelLocalTransferRequest) (*runtimev1.CancelLocalTransferResponse, error) {
	sessionID := strings.TrimSpace(req.GetInstallSessionId())
	if sessionID == "" {
		return nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, grpcerr.ReasonOptions{
			Message: "installSessionId required",
		})
	}
	control := s.transferControl(sessionID)
	s.mu.Lock()
	existing := s.transfers[sessionID]
	if existing == nil {
		s.mu.Unlock()
		return nil, grpcerr.WithReasonCodeOptions(codes.NotFound, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, grpcerr.ReasonOptions{
			Message: "transfer not found",
		})
	}
	state := normalizeTransferState(existing.GetState())
	private := s.transferPrivateLocked(sessionID)
	if state == localTransferStateCompleted {
		summary := s.projectedTransferSummaryLocked(existing)
		s.mu.Unlock()
		return &runtimev1.CancelLocalTransferResponse{Transfer: summary}, nil
	}
	if !private.cancelRequested {
		private.cancelRequested = true
		if err := s.persistStateLocked(); err != nil {
			private.cancelRequested = false
			s.mu.Unlock()
			return nil, localTransferPersistenceError(err)
		}
	}
	s.mu.Unlock()
	if control != nil {
		// The executor observes the durable cancel, stops, and discards its own
		// material; until then the cancelled transfer keeps cleanup pending.
		summary, persistErr := s.mutateLocalTransfer(sessionID, true, func(summary *runtimev1.LocalTransferSessionSummary) {
			if normalizeTransferState(summary.GetState()) == localTransferStateCancelled {
				return
			}
			summary.State = localTransferStateCancelled
			summary.Message = "transfer cancelled"
			summary.ReasonCode = "LOCAL_TRANSFER_CANCELLED"
			summary.Retryable = false
			summary.CleanupPending = true
		})
		if persistErr != nil {
			return nil, localTransferPersistenceError(persistErr)
		}
		_ = control.cancel()
		return &runtimev1.CancelLocalTransferResponse{Transfer: summary}, nil
	}
	_, persistErr := s.mutateLocalTransfer(sessionID, true, func(summary *runtimev1.LocalTransferSessionSummary) {
		if normalizeTransferState(summary.GetState()) == localTransferStateCancelled && !summary.GetCleanupPending() {
			return
		}
		summary.State = localTransferStateCancelled
		summary.Message = "transfer cancelled"
		summary.ReasonCode = "LOCAL_TRANSFER_CANCELLED"
		summary.Retryable = false
	})
	if persistErr != nil {
		return nil, localTransferPersistenceError(persistErr)
	}
	s.discardUncommittedIntentView(sessionID)
	s.discardAcquisitionMaterial(sessionID)
	s.retryModelAssetCleanupObligations()
	return &runtimev1.CancelLocalTransferResponse{Transfer: s.localTransferSummary(sessionID)}, nil
}

func (s *Service) WatchLocalTransfers(_ *runtimev1.WatchLocalTransfersRequest, stream grpc.ServerStreamingServer[runtimev1.LocalTransferProgressEvent]) error {
	relay := streamutil.NewRelay(streamutil.RelayOptions[*runtimev1.LocalTransferProgressEvent]{
		Budget:              localTransferStreamBudget,
		MaxConsecutiveDrops: 3,
		CloseErr:            status.Error(codes.ResourceExhausted, "slow consumer"),
		IsTerminal: func(event *runtimev1.LocalTransferProgressEvent) bool {
			if event == nil {
				return false
			}
			return event.GetDone()
		},
	})
	defer func() { relay.Close() }()

	done := make(chan error, 1)
	go func() {
		done <- relay.Run(stream.Context(), func(event *runtimev1.LocalTransferProgressEvent) error {
			return stream.Send(event)
		})
	}()

	s.mu.Lock()
	subscriberID, updates := s.addTransferSubscriberLocked()
	existing := s.listLocalTransferSummariesLocked()
	if len(existing) > localTransferStreamBudget {
		existing = existing[:localTransferStreamBudget]
	}
	s.mu.Unlock()
	defer s.removeTransferSubscriber(subscriberID)

	for _, summary := range existing {
		if err := relay.Enqueue(localTransferEventFromSummary(summary)); err != nil {
			return err
		}
	}

	for {
		select {
		case <-stream.Context().Done():
			if err := rpcctx.ContextDoneError(stream.Context()); err == nil {
				return nil
			}
			return rpcctx.ContextDoneError(stream.Context())
		case err := <-done:
			if err == nil && rpcctx.WasServerShutdown(stream.Context()) {
				return rpcctx.ServerShutdownError()
			}
			return err
		case event, ok := <-updates:
			if !ok {
				return nil
			}
			if err := relay.Enqueue(event); err != nil {
				return err
			}
		}
	}
}

func clampInt64Minimum(value int64, minimum int64) int64 {
	if value < minimum {
		return minimum
	}
	return value
}
