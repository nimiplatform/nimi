package ai

import (
	"context"
	"io"
	"log/slog"
	"os"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	runtimeartifact "github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
)

func TestResolveTextGenerateArtifactPathResolvesOwnedRuntimeArtifact(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	svc := newTestService(logger)
	store := runtimeartifact.NewMemoryStore()
	svc.SetRuntimeArtifactStore(store)
	payload := []byte("fake-png-bytes")
	if err := store.Put("artifact_upload", runtimeartifact.ArtifactRecord{
		Bytes:    payload,
		MimeType: "image/png",
		Owner:    &runtimeartifact.ArtifactOwner{SubjectUserID: "user", AppID: "app"},
	}); err != nil {
		t.Fatalf("seed runtime artifact: %v", err)
	}
	if err := store.Put("artifact_ownerless", runtimeartifact.ArtifactRecord{
		Bytes:    payload,
		MimeType: "image/png",
	}); err != nil {
		t.Fatalf("seed ownerless artifact: %v", err)
	}

	t.Run("owner match resolves bytes", func(t *testing.T) {
		head := &runtimev1.ScenarioRequestHead{AppId: "app", SubjectUserId: "user"}
		path, mimeType, cleanup, err := svc.resolveTextGenerateArtifactPath(context.Background(), head, true, &runtimev1.ChatContentArtifactRef{
			LocalArtifactId: "artifact_upload",
			MimeType:        "image/png",
		})
		if err != nil {
			t.Fatalf("resolve owned artifact: %v", err)
		}
		defer cleanup()
		if mimeType != "image/png" {
			t.Fatalf("mime = %q", mimeType)
		}
		raw, readErr := os.ReadFile(path)
		if readErr != nil || string(raw) != string(payload) {
			t.Fatalf("resolved payload mismatch: %v", readErr)
		}
	})

	t.Run("cross subject fails closed", func(t *testing.T) {
		head := &runtimev1.ScenarioRequestHead{AppId: "app", SubjectUserId: "other-user"}
		_, _, _, err := svc.resolveTextGenerateArtifactPath(context.Background(), head, true, &runtimev1.ChatContentArtifactRef{
			LocalArtifactId: "artifact_upload",
			MimeType:        "image/png",
		})
		if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_AI_INPUT_INVALID {
			t.Fatalf("reason = %v, err=%v", reason, err)
		}
	})

	t.Run("cross app fails closed", func(t *testing.T) {
		head := &runtimev1.ScenarioRequestHead{AppId: "other-app", SubjectUserId: "user"}
		_, _, _, err := svc.resolveTextGenerateArtifactPath(context.Background(), head, true, &runtimev1.ChatContentArtifactRef{
			LocalArtifactId: "artifact_upload",
			MimeType:        "image/png",
		})
		if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_AI_INPUT_INVALID {
			t.Fatalf("reason = %v, err=%v", reason, err)
		}
	})

	t.Run("ownerless record never falls through to legacy asset resolution", func(t *testing.T) {
		head := &runtimev1.ScenarioRequestHead{AppId: "app", SubjectUserId: "user"}
		_, _, _, err := svc.resolveTextGenerateArtifactPath(context.Background(), head, false, &runtimev1.ChatContentArtifactRef{
			LocalArtifactId: "artifact_ownerless",
			MimeType:        "image/png",
		})
		if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_AI_INPUT_INVALID {
			t.Fatalf("reason = %v, err=%v", reason, err)
		}
	})
}
