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

// A file import whose context is already done must abort before staging,
// settle the session as cancelled, and leave the source file untouched.
func TestImportLocalModelFileAbortsOnCancelledContext(t *testing.T) {
	svc := newTestService(t)
	sourceDir := t.TempDir()
	sourcePath := filepath.Join(sourceDir, "Qwen3-4B-Q4_K_M.gguf")
	if err := os.WriteFile(sourcePath, validTestGGUF(), 0o644); err != nil {
		t.Fatalf("write source model: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := svc.ImportLocalAssetFile(ctx, &runtimev1.ImportLocalAssetFileRequest{
		FilePath:     sourcePath,
		Capabilities: []string{"chat"},
		Engine:       "llama",
	})
	if err == nil {
		t.Fatal("expected import to abort on a cancelled context")
	}
	transfers, listErr := svc.ListLocalTransfers(context.Background(), &runtimev1.ListLocalTransfersRequest{})
	if listErr != nil {
		t.Fatalf("ListLocalTransfers: %v", listErr)
	}
	if len(transfers.GetTransfers()) != 1 {
		t.Fatalf("transfers = %d, want 1", len(transfers.GetTransfers()))
	}
	transfer := transfers.GetTransfers()[0]
	if transfer.GetState() != localTransferStateCancelled {
		t.Fatalf("transfer state = %q, want cancelled", transfer.GetState())
	}
	if transfer.GetReasonCode() != "LOCAL_TRANSFER_CANCELLED" {
		t.Fatalf("transfer reason = %q, want LOCAL_TRANSFER_CANCELLED", transfer.GetReasonCode())
	}
	if _, statErr := os.Stat(sourcePath); statErr != nil {
		t.Fatalf("source file must survive an aborted import: %v", statErr)
	}
	if entries, globErr := filepath.Glob(filepath.Join(resolveLocalModelsPath(svc.localModelsPath), "resolved", "nimi", "*")); globErr != nil || len(entries) != 0 {
		t.Fatalf("aborted import must not leave a managed bundle behind: entries=%v err=%v", entries, globErr)
	}
}

// A progress callback error must abort the staged copy instead of silently
// copying the whole file.
func TestCopyFileWithProgressAbortsOnProgressError(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "source.gguf")
	if err := os.WriteFile(sourcePath, []byte("0123456789"), 0o644); err != nil {
		t.Fatalf("write source: %v", err)
	}
	destPath := filepath.Join(dir, "dest.gguf")
	err := copyFileWithProgress(sourcePath, destPath, 0o644, func(int64) error {
		return errLocalTransferCancelled
	})
	if !errors.Is(err, errLocalTransferCancelled) {
		t.Fatalf("copy error = %v, want errLocalTransferCancelled", err)
	}
}
