package runtimeartifact

import (
	"bytes"
	"context"
	"image"
	"image/gif"
	"image/jpeg"
	"image/png"
	"io"
	"log/slog"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/protectedprincipal"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
)

type putArtifactTestAuthorizer struct {
	decision accountservice.LocalAppCallerDecision
	err      error
}

func (authorizer putArtifactTestAuthorizer) AuthorizeLocalAppOperation(_ context.Context, operation accountservice.LocalAppOperation) (accountservice.LocalAppCallerDecision, error) {
	if authorizer.err != nil {
		return accountservice.LocalAppCallerDecision{}, authorizer.err
	}
	decision := authorizer.decision
	decision.Operation = operation
	switch operation {
	case accountservice.LocalAppOperationSendConversationTurn:
		decision.OperationCapability = "agents.interact"
	case accountservice.LocalAppOperationReadArtifactBytes:
		decision.OperationCapability = "data.scope.read#runtime.artifacts"
	}
	return decision, nil
}

func putArtifactTestDecision() accountservice.LocalAppCallerDecision {
	decision := artifactTestDecision()
	decision.Operation = accountservice.LocalAppOperationSendConversationTurn
	decision.OperationCapability = "agents.interact"
	return decision
}

func putArtifactTestPNG(t *testing.T) []byte {
	t.Helper()
	var buf bytes.Buffer
	if err := png.Encode(&buf, image.NewRGBA(image.Rect(0, 0, 1, 1))); err != nil {
		t.Fatalf("encode png: %v", err)
	}
	return buf.Bytes()
}

func putArtifactTestJPEG(t *testing.T) []byte {
	t.Helper()
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, image.NewRGBA(image.Rect(0, 0, 1, 1)), nil); err != nil {
		t.Fatalf("encode jpeg: %v", err)
	}
	return buf.Bytes()
}

func putArtifactTestGIF(t *testing.T) []byte {
	t.Helper()
	var buf bytes.Buffer
	if err := gif.Encode(&buf, image.NewRGBA(image.Rect(0, 0, 1, 1)), nil); err != nil {
		t.Fatalf("encode gif: %v", err)
	}
	return buf.Bytes()
}

func putArtifactTestWebP() []byte {
	payload := []byte("RIFF\x00\x00\x00\x00WEBPVP8 ")
	return payload
}

func putArtifactProtectedCtx(accountID string, appID string) context.Context {
	principal := protectedprincipal.New(
		appID,
		"desktop_account_product_v1",
		"desktop_account_product_v1",
		&runtimev1.AccountProjection{AccountId: accountID, RealmEnvironmentId: "realm-1"},
		1,
		artifactTestIdentifier(0x91),
		make(chan struct{}),
	)
	return protectedprincipal.With(context.Background(), principal)
}

func newPutArtifactTestService(store Store, authorizer LocalAppOperationAuthorizer) *Service {
	svc := New(store, slog.New(slog.NewTextHandler(io.Discard, nil)), WithLocalAppOperationAuthorizer(authorizer))
	svc.now = func() time.Time { return artifactTestNow }
	return svc
}

func TestPutArtifactRejectsOversizeBeforeMimeCheck(t *testing.T) {
	store := NewMemoryStore()
	svc := newPutArtifactTestService(store, putArtifactTestAuthorizer{decision: putArtifactTestDecision()})
	_, err := svc.PutArtifact(context.Background(), &runtimev1.PutArtifactRequest{
		MimeType: "text/plain",
		Data:     make([]byte, MaxPutArtifactBytes+1),
	})
	if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_ARTIFACT_UPLOAD_TOO_LARGE {
		t.Fatalf("oversize reason = %v, err=%v", reason, err)
	}
	if store.Len() != 0 {
		t.Fatalf("oversize payload must not be stored, len=%d", store.Len())
	}
}

func TestPutArtifactRejectsUnsupportedMime(t *testing.T) {
	store := NewMemoryStore()
	svc := newPutArtifactTestService(store, putArtifactTestAuthorizer{decision: putArtifactTestDecision()})
	for _, mimeType := range []string{"text/plain", "image/bmp", "image/svg+xml", "video/mp4", "application/pdf"} {
		_, err := svc.PutArtifact(context.Background(), &runtimev1.PutArtifactRequest{
			MimeType: mimeType,
			Data:     putArtifactTestPNG(t),
		})
		if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_ARTIFACT_UPLOAD_MIME_UNSUPPORTED {
			t.Fatalf("mime %s reason = %v, err=%v", mimeType, reason, err)
		}
	}
	if store.Len() != 0 {
		t.Fatalf("rejected payloads must not be stored, len=%d", store.Len())
	}
}

func TestPutArtifactRejectsSignatureMismatchAndCorrupt(t *testing.T) {
	store := NewMemoryStore()
	svc := newPutArtifactTestService(store, putArtifactTestAuthorizer{decision: putArtifactTestDecision()})
	corruptPNG := append([]byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A}, []byte("not-a-real-png-body")...)
	tests := []struct {
		name string
		mime string
		data []byte
	}{
		{name: "jpeg declared as png", mime: "image/png", data: putArtifactTestJPEG(t)},
		{name: "png declared as jpeg", mime: "image/jpeg", data: putArtifactTestPNG(t)},
		{name: "png declared as webp", mime: "image/webp", data: putArtifactTestPNG(t)},
		{name: "empty payload", mime: "image/png", data: nil},
		{name: "corrupt png body", mime: "image/png", data: corruptPNG},
		{name: "truncated riff", mime: "image/webp", data: []byte("RIFF")},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := svc.PutArtifact(context.Background(), &runtimev1.PutArtifactRequest{
				MimeType: test.mime,
				Data:     test.data,
			})
			if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_ARTIFACT_UPLOAD_CONTENT_MISMATCH {
				t.Fatalf("reason = %v, err=%v", reason, err)
			}
		})
	}
	if store.Len() != 0 {
		t.Fatalf("rejected payloads must not be stored, len=%d", store.Len())
	}
}

func TestPutArtifactAdmitsWhitelistedImagesWithOwner(t *testing.T) {
	store := NewMemoryStore()
	svc := newPutArtifactTestService(store, putArtifactTestAuthorizer{decision: putArtifactTestDecision()})
	tests := []struct {
		mime string
		data []byte
	}{
		{mime: "image/png", data: putArtifactTestPNG(t)},
		{mime: "image/jpeg", data: putArtifactTestJPEG(t)},
		{mime: "image/gif", data: putArtifactTestGIF(t)},
		{mime: "image/webp", data: putArtifactTestWebP()},
	}
	for _, test := range tests {
		t.Run(test.mime, func(t *testing.T) {
			response, err := svc.PutArtifact(context.Background(), &runtimev1.PutArtifactRequest{
				MimeType:    test.mime,
				DisplayName: "photo",
				Data:        test.data,
			})
			if err != nil {
				t.Fatalf("PutArtifact: %v", err)
			}
			artifactID := strings.TrimSpace(response.GetArtifactId())
			if !strings.HasPrefix(artifactID, "artifact_") {
				t.Fatalf("artifact_id shape = %q", artifactID)
			}
			record, ok := store.Get(artifactID)
			if !ok {
				t.Fatalf("stored record missing for %s", artifactID)
			}
			if record.MimeType != test.mime {
				t.Fatalf("stored mime = %q want %q", record.MimeType, test.mime)
			}
			if !bytes.Equal(record.Bytes, test.data) {
				t.Fatalf("stored bytes mismatch")
			}
			if record.Owner == nil || record.Owner.SubjectUserID != "account-1" || record.Owner.AppID != "world.nimi.app" {
				t.Fatalf("owner metadata = %#v", record.Owner)
			}
		})
	}
}

func TestPutArtifactRequiresAuthorizedCaller(t *testing.T) {
	store := NewMemoryStore()
	unauthorized := New(store, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if _, err := unauthorized.PutArtifact(context.Background(), &runtimev1.PutArtifactRequest{
		MimeType: "image/png",
		Data:     putArtifactTestPNG(t),
	}); artifactReason(err) != runtimev1.ReasonCode_ARTIFACT_FORBIDDEN {
		t.Fatalf("no caller identity reason = %v", artifactReason(err))
	}
	if store.Len() != 0 {
		t.Fatalf("unauthorized upload must not be stored, len=%d", store.Len())
	}
}

func TestPutArtifactRegisteredAppOwnerReadAccess(t *testing.T) {
	store := NewMemoryStore()
	svc := newPutArtifactTestService(store, putArtifactTestAuthorizer{decision: putArtifactTestDecision()})
	response, err := svc.PutArtifact(context.Background(), &runtimev1.PutArtifactRequest{
		MimeType: "image/png",
		Data:     putArtifactTestPNG(t),
	})
	if err != nil {
		t.Fatalf("PutArtifact: %v", err)
	}
	artifactID := response.GetArtifactId()

	ownerRead, err := svc.ReadArtifactBytes(context.Background(), &runtimev1.ReadArtifactBytesRequest{ArtifactId: artifactID})
	if err != nil {
		t.Fatalf("owner read-back: %v", err)
	}
	if ownerRead.GetMimeType() != "image/png" || len(ownerRead.GetBytes()) == 0 {
		t.Fatalf("owner read-back mismatch: %#v", ownerRead)
	}

	crossAccount := putArtifactTestDecision()
	crossAccount.AccountID = "account-2"
	crossSvc := newPutArtifactTestService(store, putArtifactTestAuthorizer{decision: crossAccount})
	if _, err := crossSvc.ReadArtifactBytes(context.Background(), &runtimev1.ReadArtifactBytesRequest{ArtifactId: artifactID}); artifactReason(err) != runtimev1.ReasonCode_ARTIFACT_FORBIDDEN {
		t.Fatalf("cross-owner read reason = %v", artifactReason(err))
	}

	crossApp := putArtifactTestDecision()
	crossApp.AppID = "other.nimi.app"
	crossAppSvc := newPutArtifactTestService(store, putArtifactTestAuthorizer{decision: crossApp})
	if _, err := crossAppSvc.ReadArtifactBytes(context.Background(), &runtimev1.ReadArtifactBytesRequest{ArtifactId: artifactID}); artifactReason(err) != runtimev1.ReasonCode_ARTIFACT_FORBIDDEN {
		t.Fatalf("cross-app read reason = %v", artifactReason(err))
	}
}

func TestPutArtifactProtectedOwnerReadAndCrossOwnerForbidden(t *testing.T) {
	store := NewMemoryStore()
	svc := New(store, slog.New(slog.NewTextHandler(io.Discard, nil)))
	svc.now = func() time.Time { return artifactTestNow }
	response, err := svc.PutArtifact(putArtifactProtectedCtx("account-1", "nimi.desktop"), &runtimev1.PutArtifactRequest{
		MimeType: "image/png",
		Data:     putArtifactTestPNG(t),
	})
	if err != nil {
		t.Fatalf("PutArtifact: %v", err)
	}
	artifactID := response.GetArtifactId()
	record, ok := store.Get(artifactID)
	if !ok || record.Owner == nil || record.Owner.SubjectUserID != "account-1" || record.Owner.AppID != "nimi.desktop" {
		t.Fatalf("protected upload owner = %#v ok=%v", record.Owner, ok)
	}
	if _, err := svc.ReadArtifactBytes(putArtifactProtectedCtx("account-1", "nimi.desktop"), &runtimev1.ReadArtifactBytesRequest{ArtifactId: artifactID}); err != nil {
		t.Fatalf("protected owner read-back: %v", err)
	}
	if _, err := svc.ReadArtifactBytes(putArtifactProtectedCtx("account-2", "nimi.desktop"), &runtimev1.ReadArtifactBytesRequest{ArtifactId: artifactID}); artifactReason(err) != runtimev1.ReasonCode_ARTIFACT_FORBIDDEN {
		t.Fatalf("protected cross-owner read reason = %v", artifactReason(err))
	}
}

func TestDiskStoreOwnerMetadataRoundTrip(t *testing.T) {
	store, err := NewDiskStore(t.TempDir())
	if err != nil {
		t.Fatalf("NewDiskStore: %v", err)
	}
	owner := &ArtifactOwner{SubjectUserID: "account-1", AppID: "nimi.desktop"}
	if err := store.Put("artifact-owner", ArtifactRecord{
		Bytes:    []byte("payload"),
		MimeType: "image/png",
		Owner:    owner,
	}); err != nil {
		t.Fatalf("Put: %v", err)
	}
	record, ok := store.Get("artifact-owner")
	if !ok || record.Owner == nil || *record.Owner != *owner {
		t.Fatalf("owner round-trip = %#v ok=%v", record.Owner, ok)
	}
	reopened, err := NewDiskStore(store.root)
	if err != nil {
		t.Fatalf("reopen disk store: %v", err)
	}
	record, ok = reopened.Get("artifact-owner")
	if !ok || record.Owner == nil || *record.Owner != *owner {
		t.Fatalf("owner after reopen = %#v ok=%v", record.Owner, ok)
	}
}
