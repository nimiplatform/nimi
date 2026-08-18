package localservice

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// A transfer persisted at a non-terminal state has no driver after a daemon
// restart. restoreState must fail it closed so it never projects a
// permanently frozen in-progress session.
func TestRestoreStateFailsOrphanedTransfers(t *testing.T) {
	statePath := filepath.Join(t.TempDir(), "local-state.json")
	runtimeRoot := t.TempDir()
	newService := func(t *testing.T) *Service {
		t.Helper()
		svc, err := NewWithProductControlDataRoot(
			slog.New(slog.NewTextHandler(io.Discard, nil)),
			nil,
			statePath,
			0,
			filepath.Join(runtimeRoot, "models"),
			runtimeRoot,
		)
		if err != nil {
			t.Fatalf("create local service: %v", err)
		}
		return svc
	}

	svc := newService(t)
	orphan := svc.newLocalTransfer(localTransferKindImport, localTransferMutation{
		ModelID:    "local-import/orphan",
		Phase:      "move",
		State:      localTransferStateRunning,
		Message:    "staging local model file",
		BytesTotal: 1024,
	})
	settled := svc.newLocalTransfer(localTransferKindDownload, localTransferMutation{
		ModelID: "local-import/settled",
		Phase:   "register",
		State:   localTransferStateCompleted,
	})
	svc.Close()

	restored := newService(t)
	defer restored.Close()

	if summary := restored.localTransferSummary(orphan.GetInstallSessionId()); summary.GetState() != localTransferStateFailed {
		t.Fatalf("orphan transfer state = %q, want failed", summary.GetState())
	} else {
		if summary.GetReasonCode() != "LOCAL_TRANSFER_INTERRUPTED" {
			t.Fatalf("orphan reason = %q, want LOCAL_TRANSFER_INTERRUPTED", summary.GetReasonCode())
		}
		if summary.GetRetryable() {
			t.Fatal("orphan transfer must not be retryable in place: no driver survives the restart")
		}
		if summary.GetSpeedBytesPerSec() != 0 || summary.GetEtaSeconds() != 0 {
			t.Fatalf("orphan transfer must not carry a stale rate: %+v", summary)
		}
	}
	if summary := restored.localTransferSummary(settled.GetInstallSessionId()); summary.GetState() != localTransferStateCompleted {
		t.Fatalf("terminal transfer state = %q, want completed (untouched)", summary.GetState())
	}

	// The healed snapshot must persist: a second restart sees the failed state.
	restored.Close()
	again := newService(t)
	defer again.Close()
	if summary := again.localTransferSummary(orphan.GetInstallSessionId()); summary.GetState() != localTransferStateFailed {
		t.Fatalf("healed orphan transfer state = %q, want failed after re-restore", summary.GetState())
	}
}

// CancelLocalTransfer on an import session must trip the session's transfer
// control so an in-flight import observes the cancellation.
func TestCancelLocalTransferTripsImportControl(t *testing.T) {
	svc := newTestService(t)
	transfer := svc.newLocalTransfer(localTransferKindImport, localTransferMutation{
		ModelID: "local-import/cancellable",
		Phase:   "copy",
		State:   localTransferStateRunning,
	})
	sessionID := transfer.GetInstallSessionId()
	control := svc.transferControl(sessionID)
	if control == nil {
		t.Fatal("import transfer must own a cancellation control")
	}
	if _, err := svc.CancelLocalTransfer(context.Background(), &runtimev1.CancelLocalTransferRequest{
		InstallSessionId: sessionID,
	}); err != nil {
		t.Fatalf("CancelLocalTransfer: %v", err)
	}
	if err := control.wait(context.Background()); !errors.Is(err, errLocalTransferCancelled) {
		t.Fatalf("control wait = %v, want errLocalTransferCancelled", err)
	}
	if summary := svc.localTransferSummary(sessionID); summary.GetState() != localTransferStateCancelled {
		t.Fatalf("state = %q, want cancelled", summary.GetState())
	}
}

func TestModelInstallRPCErrorProjectsTransferCancellation(t *testing.T) {
	err := modelInstallRPCError(errLocalTransferCancelled)
	if status.Code(err) != codes.Canceled {
		t.Fatalf("status code = %s, want Canceled", status.Code(err))
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_LOCAL_EXECUTION_CANCELED {
		t.Fatalf("reason = %s ok=%v, want AI_LOCAL_EXECUTION_CANCELED", reason, ok)
	}
}

func TestCancelLocalTransferLeavesActiveDownloadCleanupToExecutor(t *testing.T) {
	svc := newTestService(t)
	transfer := svc.newLocalTransfer(localTransferKindDownload, localTransferMutation{
		ModelID: "local-download/active-cancel",
		Phase:   "download",
		State:   localTransferStateRunning,
	})
	sessionID := transfer.GetInstallSessionId()
	control := svc.transferControl(sessionID)
	if control == nil {
		t.Fatal("download transfer must own a cancellation control")
	}
	stageDir := managedModelDownloadStageDir(
		svc.resolvedLocalModelsPath(),
		managedModelAcquisitionStorageID(transfer.GetAssetId(), sessionID),
	)
	partialPath := filepath.Join(stageDir, "model.bin.download")
	if err := os.MkdirAll(stageDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(partialPath, []byte("partial"), 0o600); err != nil {
		t.Fatal(err)
	}

	response, err := svc.CancelLocalTransfer(context.Background(), &runtimev1.CancelLocalTransferRequest{
		InstallSessionId: sessionID,
	})
	if err != nil || response.GetTransfer().GetState() != localTransferStateCancelled {
		t.Fatalf("CancelLocalTransfer: response=%+v err=%v", response, err)
	}
	if err := control.wait(context.Background()); !errors.Is(err, errLocalTransferCancelled) {
		t.Fatalf("control wait = %v, want errLocalTransferCancelled", err)
	}
	if _, err := os.Stat(partialPath); err != nil {
		t.Fatalf("active cancel removed executor-owned staging: %v", err)
	}
}

func TestPauseAndResumeLocalTransferControlsImport(t *testing.T) {
	svc := newTestService(t)
	transfer := svc.newLocalTransfer(localTransferKindImport, localTransferMutation{
		ModelID: "model_pause_resume",
		Phase:   "hashing",
		State:   localTransferStateRunning,
	})
	sessionID := transfer.GetInstallSessionId()
	paused, err := svc.PauseLocalTransfer(context.Background(), &runtimev1.PauseLocalTransferRequest{InstallSessionId: sessionID})
	if err != nil || paused.GetTransfer().GetState() != localTransferStatePaused {
		t.Fatalf("pause import = %+v err=%v", paused, err)
	}
	waited := make(chan error, 1)
	go func() { waited <- svc.transferControl(sessionID).wait(context.Background()) }()
	select {
	case err := <-waited:
		t.Fatalf("paused import control returned early: %v", err)
	default:
	}
	resumed, err := svc.ResumeLocalTransfer(context.Background(), &runtimev1.ResumeLocalTransferRequest{InstallSessionId: sessionID})
	if err != nil || resumed.GetTransfer().GetState() != localTransferStateRunning {
		t.Fatalf("resume import = %+v err=%v", resumed, err)
	}
	if err := <-waited; err != nil {
		t.Fatalf("resumed import control = %v", err)
	}
}

func TestPauseAndResumeResetTransferRate(t *testing.T) {
	svc := newTestService(t)
	transfer := svc.newLocalTransfer(localTransferKindDownload, localTransferMutation{
		ModelID:          "model_pause_resume_rate",
		Phase:            "download",
		State:            localTransferStateRunning,
		SpeedBytesPerSec: 125,
		EtaSeconds:       6,
	})
	sessionID := transfer.GetInstallSessionId()
	svc.mu.Lock()
	svc.transferRates[sessionID] = &transferRateTracker{samples: []transferRateSample{
		{at: time.Unix(1_700_000_000, 0), bytes: 0},
		{at: time.Unix(1_700_000_001, 0), bytes: 125},
	}}
	svc.mu.Unlock()

	paused, err := svc.PauseLocalTransfer(context.Background(), &runtimev1.PauseLocalTransferRequest{InstallSessionId: sessionID})
	if err != nil {
		t.Fatalf("pause transfer: %v", err)
	}
	if got := paused.GetTransfer(); got.GetSpeedBytesPerSec() != 0 || got.GetEtaSeconds() != 0 {
		t.Fatalf("paused transfer retained active rate: speed=%d eta=%d", got.GetSpeedBytesPerSec(), got.GetEtaSeconds())
	}
	svc.mu.RLock()
	_, trackerAfterPause := svc.transferRates[sessionID]
	svc.mu.RUnlock()
	if trackerAfterPause {
		t.Fatal("paused transfer retained estimator samples")
	}

	resumed, err := svc.ResumeLocalTransfer(context.Background(), &runtimev1.ResumeLocalTransferRequest{InstallSessionId: sessionID})
	if err != nil {
		t.Fatalf("resume transfer: %v", err)
	}
	if got := resumed.GetTransfer(); got.GetSpeedBytesPerSec() != 0 || got.GetEtaSeconds() != 0 {
		t.Fatalf("resumed transfer reused stale rate: speed=%d eta=%d", got.GetSpeedBytesPerSec(), got.GetEtaSeconds())
	}
}

func TestTerminalTransferStatesClearActiveRate(t *testing.T) {
	tests := []struct {
		name   string
		settle func(*Service, string) error
	}{
		{
			name: "cancelled",
			settle: func(svc *Service, sessionID string) error {
				_, err := svc.CancelLocalTransfer(context.Background(), &runtimev1.CancelLocalTransferRequest{InstallSessionId: sessionID})
				return err
			},
		},
		{
			name: "failed",
			settle: func(svc *Service, sessionID string) error {
				return svc.failTransfer(sessionID, "network failed", true)
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			svc := newTestService(t)
			transfer := svc.newLocalTransfer(localTransferKindDownload, localTransferMutation{
				ModelID:          "model_terminal_rate_" + test.name,
				Phase:            "download",
				State:            localTransferStateRunning,
				SpeedBytesPerSec: 125,
				EtaSeconds:       6,
			})
			if err := test.settle(svc, transfer.GetInstallSessionId()); err != nil {
				t.Fatalf("settle transfer: %v", err)
			}
			got := svc.localTransferSummary(transfer.GetInstallSessionId())
			if got.GetSpeedBytesPerSec() != 0 || got.GetEtaSeconds() != 0 {
				t.Fatalf("terminal transfer retained active rate: state=%s speed=%d eta=%d", got.GetState(), got.GetSpeedBytesPerSec(), got.GetEtaSeconds())
			}
		})
	}
}

func TestPauseLocalTransferPersistenceFailureLeavesExecutorRunning(t *testing.T) {
	svc := newTestService(t)
	transfer := svc.newLocalTransfer(localTransferKindImport, localTransferMutation{
		ModelID: "model_pause_persist_failure",
		Phase:   "copy",
		State:   localTransferStateRunning,
	})
	control := svc.transferControl(transfer.GetInstallSessionId())
	if control == nil {
		t.Fatal("running transfer has no control")
	}
	svc.stateStorePath = t.TempDir()

	response, err := svc.PauseLocalTransfer(context.Background(), &runtimev1.PauseLocalTransferRequest{
		InstallSessionId: transfer.GetInstallSessionId(),
	})
	if status.Code(err) != codes.Unavailable || response != nil {
		t.Fatalf("pause persistence failure response=%+v err=%v", response, err)
	}
	if summary := svc.localTransferSummary(transfer.GetInstallSessionId()); summary.GetState() != localTransferStateRunning {
		t.Fatalf("pause persistence failure changed summary: %+v", summary)
	}
	if err := control.wait(context.Background()); err != nil {
		t.Fatalf("pause persistence failure changed executor control: %v", err)
	}
}

func TestResumeLocalTransferPersistenceFailureLeavesExecutorPaused(t *testing.T) {
	svc := newTestService(t)
	transfer := svc.newLocalTransfer(localTransferKindImport, localTransferMutation{
		ModelID: "model_resume_persist_failure",
		Phase:   "copy",
		State:   localTransferStateRunning,
	})
	if _, err := svc.PauseLocalTransfer(context.Background(), &runtimev1.PauseLocalTransferRequest{
		InstallSessionId: transfer.GetInstallSessionId(),
	}); err != nil {
		t.Fatalf("prepare paused transfer: %v", err)
	}
	control := svc.transferControl(transfer.GetInstallSessionId())
	if control == nil {
		t.Fatal("paused transfer has no control")
	}
	svc.stateStorePath = t.TempDir()

	response, err := svc.ResumeLocalTransfer(context.Background(), &runtimev1.ResumeLocalTransferRequest{
		InstallSessionId: transfer.GetInstallSessionId(),
	})
	if status.Code(err) != codes.Unavailable || response != nil {
		t.Fatalf("resume persistence failure response=%+v err=%v", response, err)
	}
	if summary := svc.localTransferSummary(transfer.GetInstallSessionId()); summary.GetState() != localTransferStatePaused {
		t.Fatalf("resume persistence failure changed summary: %+v", summary)
	}
	waitCtx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	if err := control.wait(waitCtx); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("resume persistence failure released paused executor: %v", err)
	}
}

func TestCancelLocalTransferPersistenceFailurePreservesControlAndStaging(t *testing.T) {
	svc := newTestService(t)
	transfer := svc.newLocalTransfer(localTransferKindDownload, localTransferMutation{
		ModelID: "model_cancel_persist_failure",
		Phase:   "download",
		State:   localTransferStateRunning,
	})
	control := svc.transferControl(transfer.GetInstallSessionId())
	if control == nil {
		t.Fatal("running transfer has no control")
	}
	stageDir := managedModelDownloadStageDir(
		svc.resolvedLocalModelsPath(),
		managedModelAcquisitionStorageID(transfer.GetAssetId(), transfer.GetInstallSessionId()),
	)
	if err := os.MkdirAll(stageDir, 0o755); err != nil {
		t.Fatal(err)
	}
	partialPath := filepath.Join(stageDir, "model.bin.download")
	if err := os.WriteFile(partialPath, []byte("partial"), 0o600); err != nil {
		t.Fatal(err)
	}
	svc.stateStorePath = t.TempDir()

	response, err := svc.CancelLocalTransfer(context.Background(), &runtimev1.CancelLocalTransferRequest{
		InstallSessionId: transfer.GetInstallSessionId(),
	})
	if status.Code(err) != codes.Unavailable || response != nil {
		t.Fatalf("cancel persistence failure response=%+v err=%v", response, err)
	}
	if summary := svc.localTransferSummary(transfer.GetInstallSessionId()); summary.GetState() != localTransferStateRunning {
		t.Fatalf("cancel persistence failure changed summary: %+v", summary)
	}
	if err := control.wait(context.Background()); err != nil {
		t.Fatalf("cancel persistence failure changed executor control: %v", err)
	}
	if _, err := os.Stat(partialPath); err != nil {
		t.Fatalf("cancel persistence failure removed staging: %v", err)
	}
}

func TestCompleteTransferPersistenceFailureDoesNotPublishTerminalState(t *testing.T) {
	svc := newTestService(t)
	transfer := svc.newLocalTransfer(localTransferKindDownload, localTransferMutation{
		ModelID: "model_complete_persist_failure",
		Phase:   "download",
		State:   localTransferStateRunning,
	})
	svc.mu.Lock()
	subscriberID, updates := svc.addTransferSubscriberLocked()
	svc.mu.Unlock()
	defer svc.removeTransferSubscriber(subscriberID)
	svc.stateStorePath = t.TempDir()

	if err := svc.completeTransfer(transfer.GetInstallSessionId(), "register", "model installed", nil); err == nil {
		t.Fatal("terminal persistence failure returned success")
	}
	if summary := svc.localTransferSummary(transfer.GetInstallSessionId()); summary.GetState() != localTransferStateRunning {
		t.Fatalf("terminal persistence failure changed summary: %+v", summary)
	}
	select {
	case event := <-updates:
		t.Fatalf("terminal persistence failure published event: %+v", event)
	default:
	}
}

// Late progress samples and a trailing completion from an in-flight worker
// must never resurrect a session that already settled.
func TestTerminalTransferStateIsNotResurrected(t *testing.T) {
	svc := newTestService(t)
	transfer := svc.newLocalTransfer(localTransferKindImport, localTransferMutation{
		ModelID:    "local-import/terminal",
		Phase:      "copy",
		State:      localTransferStateRunning,
		BytesTotal: 10,
	})
	sessionID := transfer.GetInstallSessionId()
	svc.cancelTransfer(sessionID, "transfer cancelled")

	svc.updateTransferProgress(sessionID, "copy", 5, 10, "staging local model file")
	if summary := svc.localTransferSummary(sessionID); summary.GetState() != localTransferStateCancelled {
		t.Fatalf("state after late progress = %q, want cancelled", summary.GetState())
	}
	svc.completeTransfer(sessionID, "register", "local model imported", nil)
	if summary := svc.localTransferSummary(sessionID); summary.GetState() != localTransferStateCancelled {
		t.Fatalf("state after late completion = %q, want cancelled", summary.GetState())
	}
}

func TestPausedTransferStateIsNotResurrectedByLateProgress(t *testing.T) {
	svc := newTestService(t)
	transfer := svc.newLocalTransfer(localTransferKindDownload, localTransferMutation{
		ModelID:    "local-download/paused",
		Phase:      "download",
		State:      localTransferStateRunning,
		BytesTotal: 10,
	})
	sessionID := transfer.GetInstallSessionId()
	if _, err := svc.PauseLocalTransfer(context.Background(), &runtimev1.PauseLocalTransferRequest{
		InstallSessionId: sessionID,
	}); err != nil {
		t.Fatalf("pause transfer: %v", err)
	}

	svc.updateTransferProgress(sessionID, "download", 5, 10, "late in-flight sample")
	if summary := svc.localTransferSummary(sessionID); summary.GetState() != localTransferStatePaused {
		t.Fatalf("state after late progress = %q, want paused", summary.GetState())
	}
}

func TestCancelTransferClearsManagedDownloadStagingBySession(t *testing.T) {
	svc := newTestService(t)
	transfer := svc.newLocalTransfer(localTransferKindDownload, localTransferMutation{
		ModelID: "local.test.cancel-worker",
		Phase:   "download",
		State:   localTransferStateRunning,
	})
	storageID := managedModelAcquisitionStorageID(transfer.GetAssetId(), transfer.GetInstallSessionId())
	stageDir := managedModelDownloadStageDir(svc.resolvedLocalModelsPath(), storageID)
	if err := os.MkdirAll(stageDir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(stageDir, "model.bin.download"), []byte("prefix"), 0o600); err != nil {
		t.Fatal(err)
	}

	svc.cancelTransfer(transfer.GetInstallSessionId(), "transfer cancelled")
	if _, err := os.Stat(stageDir); !os.IsNotExist(err) {
		t.Fatalf("worker cancellation retained per-session staging: %s err=%v", stageDir, err)
	}
}
