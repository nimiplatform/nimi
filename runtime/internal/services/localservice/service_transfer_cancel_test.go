package localservice

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
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
