package runtimeartifact

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"path/filepath"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
)

var artifactTestNow = time.Date(2026, time.July, 11, 12, 0, 0, 0, time.UTC)

type staticLocalAppCallerAuthorizer struct {
	decision accountservice.LocalAppCallerDecision
	err      error
}

func TestReadArtifactBytesAcceptsExactLocalDevelopmentAudience(t *testing.T) {
	store := NewMemoryStore()
	projectRoot := filepath.Clean(t.TempDir())
	decision := artifactTestDecision()
	decision.AuthorizationID = artifactTestIdentifier(0x81)
	decision.AuthorizationGeneration = 4
	decision.ProjectRoot = projectRoot
	decision.CapabilityFingerprint = artifactTestIdentifier(0x82)
	decision.Process.OS = protectedlocal.OSMacOS
	decision.Process.CanonicalExecutablePath = filepath.Join(projectRoot, "Nimi Local App Host")
	decision.Process.ExecutableTrustSetID = protectedlocal.MacOSLocalDevelopmentTrustSetID
	audience := &ArtifactAudience{
		ProducerJobID: "runtime.local-development.bootstrap", OwnerAccountID: decision.AccountID, AppID: decision.AppID,
		ReleaseDigest: decision.HostExecutableDigest, SessionID: decision.SessionID, AccountGeneration: decision.AccountGeneration,
		AllowedUse: ArtifactUseReadBytes, ExpiresAt: decision.ExpiresAt,
		TrustClass: "local_development", AuthorizationID: decision.AuthorizationID,
		AuthorizationGeneration: decision.AuthorizationGeneration, ProjectRoot: decision.ProjectRoot,
		CapabilityFingerprint: decision.CapabilityFingerprint,
	}
	if err := store.Put("artifact-development", ArtifactRecord{Bytes: []byte("development"), MimeType: "text/plain", CreatedAt: artifactTestNow, Audience: audience}); err != nil {
		t.Fatal(err)
	}
	service := New(store, slog.New(slog.NewTextHandler(io.Discard, nil)), WithLocalAppOperationAuthorizer(staticLocalAppCallerAuthorizer{decision: decision}))
	service.now = func() time.Time { return artifactTestNow }
	response, err := service.ReadArtifactBytes(context.Background(), &runtimev1.ReadArtifactBytesRequest{ArtifactId: "artifact-development"})
	if err != nil || string(response.GetBytes()) != "development" {
		t.Fatalf("read exact local-development artifact = (%+v, %v)", response, err)
	}

	decision.AuthorizationGeneration++
	mismatch := New(store, slog.New(slog.NewTextHandler(io.Discard, nil)), WithLocalAppOperationAuthorizer(staticLocalAppCallerAuthorizer{decision: decision}))
	mismatch.now = func() time.Time { return artifactTestNow }
	if _, err := mismatch.ReadArtifactBytes(context.Background(), &runtimev1.ReadArtifactBytesRequest{ArtifactId: "artifact-development"}); artifactReason(err) != runtimev1.ReasonCode_ARTIFACT_FORBIDDEN {
		t.Fatalf("changed development authorization generation must fail closed, got %v", err)
	}
}

func (authorizer staticLocalAppCallerAuthorizer) AuthorizeLocalAppOperation(_ context.Context, operation accountservice.LocalAppOperation) (accountservice.LocalAppCallerDecision, error) {
	if operation != accountservice.LocalAppOperationReadArtifactBytes {
		return accountservice.LocalAppCallerDecision{}, errors.New("unexpected local-app operation")
	}
	return authorizer.decision, authorizer.err
}

func newTestService(t *testing.T) (*Service, *MemoryStore) {
	t.Helper()
	store := NewMemoryStore()
	svc := New(store, slog.New(slog.NewTextHandler(io.Discard, nil)), WithLocalAppOperationAuthorizer(staticLocalAppCallerAuthorizer{decision: artifactTestDecision()}))
	svc.now = func() time.Time { return artifactTestNow }
	return svc, store
}

func artifactTestDecision() accountservice.LocalAppCallerDecision {
	release := artifactTestIdentifier(0x31)
	projectRoot := `C:\artifact-project`
	return accountservice.LocalAppCallerDecision{
		SessionID:               artifactTestIdentifier(0x21),
		AppID:                   "world.nimi.app",
		HostExecutableDigest:    release,
		AccountID:               "account-1",
		RealmEnvironmentID:      "realm-1",
		AccountGeneration:       7,
		RuntimeBootEpoch:        artifactTestIdentifier(0x41),
		Operation:               accountservice.LocalAppOperationReadArtifactBytes,
		AuthorityClass:          localappop.AuthorityClassUserPermission,
		OperationCapability:     "data.scope.read#runtime.artifacts",
		TrustClass:              accountservice.LocalAppTrustClassDevelopment,
		AuthorizationID:         artifactTestIdentifier(0x42),
		AuthorizationGeneration: 1,
		ProjectRoot:             projectRoot,
		CapabilityFingerprint:   artifactTestIdentifier(0x43),
		Process: protectedlocal.ProcessTuple{
			OS: protectedlocal.OSWindows, PID: 4201, CreationMarker: "artifact-process-1",
			OSLoginSession: "login-1", SecurityPrincipal: "user-1",
			CanonicalExecutableIdentity: "artifact-file-1", CanonicalExecutablePath: projectRoot + `\electron.exe`, ExecutableDigest: release,
			ExecutableTrustSetID: protectedlocal.WindowsLocalDevelopmentTrustSetID,
		},
		ExpiresAt: artifactTestNow.Add(time.Hour),
	}
}

func artifactTestAudience() *ArtifactAudience {
	decision := artifactTestDecision()
	return &ArtifactAudience{
		ProducerJobID:           "job-1",
		OwnerAccountID:          decision.AccountID,
		AppID:                   decision.AppID,
		ReleaseDigest:           decision.HostExecutableDigest,
		TrustClass:              "local_development",
		AuthorizationID:         decision.AuthorizationID,
		AuthorizationGeneration: decision.AuthorizationGeneration,
		ProjectRoot:             decision.ProjectRoot,
		CapabilityFingerprint:   decision.CapabilityFingerprint,
		SessionID:               decision.SessionID,
		AccountGeneration:       decision.AccountGeneration,
		AllowedUse:              ArtifactUseReadBytes,
		ExpiresAt:               artifactTestNow.Add(30 * time.Minute),
	}
}

// TestReadArtifactBytesExisting covers the happy path: an artifact written
// via Store.Put is returned bytes/mime/size-equal by ReadArtifactBytes.
func TestReadArtifactBytesExisting(t *testing.T) {
	svc, store := newTestService(t)
	bytes := []byte("hello-audio-bytes")
	if err := store.Put("artifact-001", ArtifactRecord{
		Bytes:        bytes,
		MimeType:     "audio/wav",
		SizeBytes:    int64(len(bytes)),
		MimeInferred: false,
		CreatedAt:    artifactTestNow,
		Audience:     artifactTestAudience(),
	}); err != nil {
		t.Fatalf("Put: %v", err)
	}

	resp, err := svc.ReadArtifactBytes(context.Background(), &runtimev1.ReadArtifactBytesRequest{
		ArtifactId: "artifact-001",
	})
	if err != nil {
		t.Fatalf("ReadArtifactBytes: %v", err)
	}
	if string(resp.GetBytes()) != string(bytes) {
		t.Fatalf("bytes mismatch: got=%q want=%q", resp.GetBytes(), bytes)
	}
	if resp.GetMimeType() != "audio/wav" {
		t.Fatalf("mime_type mismatch: got=%q want=audio/wav", resp.GetMimeType())
	}
	if resp.GetSizeBytes() != int64(len(bytes)) {
		t.Fatalf("size_bytes mismatch: got=%d want=%d", resp.GetSizeBytes(), len(bytes))
	}
	if resp.GetMimeInferred() {
		t.Fatalf("mime_inferred mismatch: got=true want=false")
	}
}

// TestReadArtifactBytesInvalidInput covers ARTIFACT_INVALID_INPUT path:
// empty artifact_id must produce InvalidArgument + ReasonCode_ARTIFACT_INVALID_INPUT.
func TestReadArtifactBytesInvalidInput(t *testing.T) {
	svc, _ := newTestService(t)

	_, err := svc.ReadArtifactBytes(context.Background(), &runtimev1.ReadArtifactBytesRequest{
		ArtifactId: "   ",
	})
	if err == nil {
		t.Fatalf("ReadArtifactBytes empty id: expected error, got nil")
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_ARTIFACT_INVALID_INPUT {
		t.Fatalf("reason mismatch: got=%v ok=%v want=%v", reason, ok, runtimev1.ReasonCode_ARTIFACT_INVALID_INPUT)
	}
}

// TestReadArtifactBytesNotFound covers ARTIFACT_NOT_FOUND path: missing id
// must produce NotFound + ReasonCode_ARTIFACT_NOT_FOUND.
func TestReadArtifactBytesNotFound(t *testing.T) {
	svc, _ := newTestService(t)

	_, err := svc.ReadArtifactBytes(context.Background(), &runtimev1.ReadArtifactBytesRequest{
		ArtifactId: "missing-artifact-id",
	})
	if err == nil {
		t.Fatalf("ReadArtifactBytes missing id: expected error, got nil")
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_ARTIFACT_NOT_FOUND {
		t.Fatalf("reason mismatch: got=%v ok=%v want=%v", reason, ok, runtimev1.ReasonCode_ARTIFACT_NOT_FOUND)
	}
}

// TestReadArtifactBytesTooLarge covers ARTIFACT_TOO_LARGE path: artifact
// whose SizeBytes exceeds MaxInlineBytes (32 MiB) must produce
// ResourceExhausted + ReasonCode_ARTIFACT_TOO_LARGE.
//
// We exercise the size cap without allocating actual 32 MiB by recording
// SizeBytes > MaxInlineBytes while keeping Bytes empty. The server-side
// check is on record.SizeBytes, not on len(record.Bytes); this test
// matches the contract surface where size_bytes is the authoritative
// declaration.
func TestReadArtifactBytesTooLarge(t *testing.T) {
	svc, store := newTestService(t)
	payload := make([]byte, MaxInlineBytes+1)
	if err := store.Put("artifact-too-large", ArtifactRecord{
		Bytes:     payload,
		MimeType:  "video/mp4",
		CreatedAt: artifactTestNow,
		Audience:  artifactTestAudience(),
	}); err != nil {
		t.Fatalf("Put: %v", err)
	}

	_, err := svc.ReadArtifactBytes(context.Background(), &runtimev1.ReadArtifactBytesRequest{
		ArtifactId: "artifact-too-large",
	})
	if err == nil {
		t.Fatalf("ReadArtifactBytes oversized: expected error, got nil")
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_ARTIFACT_TOO_LARGE {
		t.Fatalf("reason mismatch: got=%v ok=%v want=%v", reason, ok, runtimev1.ReasonCode_ARTIFACT_TOO_LARGE)
	}
}

func TestReadArtifactBytesRequiresCurrentMatchingAudience(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	store := NewMemoryStore()
	if err := store.Put("artifact-bound", ArtifactRecord{Bytes: []byte("bound"), CreatedAt: artifactTestNow, Audience: artifactTestAudience()}); err != nil {
		t.Fatalf("Put bound: %v", err)
	}
	if err := store.Put("artifact-unbound", ArtifactRecord{Bytes: []byte("unbound")}); err != nil {
		t.Fatalf("Put unbound: %v", err)
	}
	unauthorized := New(store, logger)
	for _, artifactID := range []string{"artifact-bound", "missing-artifact"} {
		_, err := unauthorized.ReadArtifactBytes(context.Background(), &runtimev1.ReadArtifactBytesRequest{ArtifactId: artifactID})
		if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_ARTIFACT_FORBIDDEN {
			t.Fatalf("unauthorized %s reason = %v, err=%v", artifactID, reason, err)
		}
	}

	authorized := New(store, logger, WithLocalAppOperationAuthorizer(staticLocalAppCallerAuthorizer{decision: artifactTestDecision()}))
	authorized.now = func() time.Time { return artifactTestNow }
	incompletePolicy := artifactTestDecision()
	incompletePolicy.AuthorizationGeneration = 0
	incomplete := New(store, logger, WithLocalAppOperationAuthorizer(staticLocalAppCallerAuthorizer{decision: incompletePolicy}))
	incomplete.now = func() time.Time { return artifactTestNow }
	if _, err := incomplete.ReadArtifactBytes(context.Background(), &runtimev1.ReadArtifactBytesRequest{ArtifactId: "artifact-bound"}); artifactReason(err) != runtimev1.ReasonCode_ARTIFACT_FORBIDDEN {
		t.Fatalf("incomplete operation policy reason = %v, err=%v", artifactReason(err), err)
	}
	if _, err := authorized.ReadArtifactBytes(context.Background(), &runtimev1.ReadArtifactBytesRequest{ArtifactId: "artifact-unbound"}); artifactReason(err) != runtimev1.ReasonCode_ARTIFACT_FORBIDDEN {
		t.Fatalf("unbound read reason = %v, err=%v", artifactReason(err), err)
	}

	base := *artifactTestAudience()
	tests := []struct {
		name   string
		mutate func(*ArtifactAudience)
	}{
		{name: "account", mutate: func(a *ArtifactAudience) { a.OwnerAccountID = "account-2" }},
		{name: "app", mutate: func(a *ArtifactAudience) { a.AppID = "persona.nimi.app" }},
		{name: "release", mutate: func(a *ArtifactAudience) { a.ReleaseDigest = artifactTestIdentifier(0x32) }},
		{name: "session", mutate: func(a *ArtifactAudience) { a.SessionID = artifactTestIdentifier(0x22) }},
		{name: "generation", mutate: func(a *ArtifactAudience) { a.AccountGeneration++ }},
		{name: "use", mutate: func(a *ArtifactAudience) { a.AllowedUse = ArtifactUse("internal_only") }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			audience := base
			test.mutate(&audience)
			artifactID := "artifact-mismatch-" + test.name
			if err := store.Put(artifactID, ArtifactRecord{Bytes: []byte("payload"), CreatedAt: artifactTestNow, Audience: &audience}); err != nil {
				t.Fatalf("Put: %v", err)
			}
			if _, err := authorized.ReadArtifactBytes(context.Background(), &runtimev1.ReadArtifactBytesRequest{ArtifactId: artifactID}); artifactReason(err) != runtimev1.ReasonCode_ARTIFACT_FORBIDDEN {
				t.Fatalf("reason = %v, err=%v", artifactReason(err), err)
			}
		})
	}

	expiring := *artifactTestAudience()
	expiring.ExpiresAt = artifactTestNow.Add(time.Minute)
	if err := store.Put("artifact-expiring", ArtifactRecord{Bytes: []byte("payload"), CreatedAt: artifactTestNow, Audience: &expiring}); err != nil {
		t.Fatalf("Put expiring: %v", err)
	}
	authorized.now = func() time.Time { return artifactTestNow.Add(2 * time.Minute) }
	if _, err := authorized.ReadArtifactBytes(context.Background(), &runtimev1.ReadArtifactBytesRequest{ArtifactId: "artifact-expiring"}); artifactReason(err) != runtimev1.ReasonCode_ARTIFACT_FORBIDDEN {
		t.Fatalf("expired reason = %v, err=%v", artifactReason(err), err)
	}
}

// TestStorePutValidates ensures Store.Put rejects empty artifact_id at
// the storage layer (defensive; gRPC handler also rejects).
func TestStorePutValidates(t *testing.T) {
	store := NewMemoryStore()
	err := store.Put(" ", ArtifactRecord{Bytes: []byte("x")})
	if err == nil {
		t.Fatalf("Put empty id: expected error, got nil")
	}
}

func TestStoreNormalizesRecord(t *testing.T) {
	store := NewMemoryStore()
	input := []byte("payload")
	if err := store.Put(" artifact-id ", ArtifactRecord{Bytes: input}); err != nil {
		t.Fatalf("Put: %v", err)
	}
	input[0] = 'x'
	record, ok := store.Get("artifact-id")
	if !ok {
		t.Fatalf("Get: missing record")
	}
	if string(record.Bytes) != "payload" {
		t.Fatalf("bytes were not isolated: got=%q", record.Bytes)
	}
	if record.SizeBytes != int64(len("payload")) {
		t.Fatalf("size_bytes mismatch: got=%d want=%d", record.SizeBytes, len("payload"))
	}
	if record.MimeType != "application/octet-stream" || !record.MimeInferred {
		t.Fatalf("mime normalization mismatch: mime=%q inferred=%v", record.MimeType, record.MimeInferred)
	}
	if record.ContentSHA256 == "" {
		t.Fatal("content hash was not bound")
	}
	if err := store.Put("bad-size", ArtifactRecord{Bytes: []byte("payload"), SizeBytes: 1}); !errors.Is(err, ErrInvalidArtifactRecord) {
		t.Fatalf("mismatched observed size err = %v", err)
	}
	if err := store.Put("bad-hash", ArtifactRecord{Bytes: []byte("payload"), ContentSHA256: "sha256:deadbeef"}); !errors.Is(err, ErrInvalidArtifactRecord) {
		t.Fatalf("mismatched content hash err = %v", err)
	}
	incompleteAudience := *artifactTestAudience()
	incompleteAudience.ProducerJobID = ""
	if err := store.Put("bad-audience", ArtifactRecord{Bytes: []byte("payload"), CreatedAt: artifactTestNow, Audience: &incompleteAudience}); !errors.Is(err, ErrInvalidArtifactRecord) {
		t.Fatalf("incomplete audience err = %v", err)
	}
}

func TestStoreKeepsArtifactIdentityImmutable(t *testing.T) {
	store := NewMemoryStore()
	first := ArtifactRecord{Bytes: []byte("first"), CreatedAt: artifactTestNow, Audience: artifactTestAudience()}
	if err := store.Put("artifact-immutable", first); err != nil {
		t.Fatal(err)
	}
	if err := store.Put("artifact-immutable", first); err != nil {
		t.Fatalf("idempotent Put: %v", err)
	}
	enriched := first
	enriched.GeneratedVoice = &GeneratedVoiceArtifactMetadata{AgentID: "agent-1", ConversationAnchorID: "anchor-1"}
	if err := store.Put("artifact-immutable", enriched); err != nil {
		t.Fatalf("generated voice metadata enrichment: %v", err)
	}
	if err := store.Put("artifact-immutable", ArtifactRecord{Bytes: []byte("second"), CreatedAt: artifactTestNow, Audience: artifactTestAudience()}); !errors.Is(err, ErrInvalidArtifactRecord) {
		t.Fatalf("content replacement err = %v", err)
	}
	changedAudience := *artifactTestAudience()
	changedAudience.OwnerAccountID = "account-2"
	if err := store.Put("artifact-immutable", ArtifactRecord{Bytes: []byte("first"), CreatedAt: artifactTestNow, Audience: &changedAudience}); !errors.Is(err, ErrInvalidArtifactRecord) {
		t.Fatalf("audience replacement err = %v", err)
	}
	record, ok := store.Get("artifact-immutable")
	if !ok || string(record.Bytes) != "first" || record.Audience == nil || record.Audience.OwnerAccountID != "account-1" || record.GeneratedVoice == nil || record.GeneratedVoice.AgentID != "agent-1" {
		t.Fatalf("immutable record changed: %#v ok=%v", record, ok)
	}
}

func artifactTestIdentifier(value byte) protectedlocal.Identifier {
	var identifier protectedlocal.Identifier
	for index := range identifier {
		identifier[index] = value
	}
	return identifier
}

func artifactReason(err error) runtimev1.ReasonCode {
	reason, _ := grpcerr.ExtractReasonCode(err)
	return reason
}

// TestStoreDeleteIdempotent ensures Store.Delete is idempotent for both
// existing and missing ids (matching contract: delete missing is not an
// error).
func TestStoreDeleteIdempotent(t *testing.T) {
	store := NewMemoryStore()
	if err := store.Put("p1", ArtifactRecord{Bytes: []byte("x"), SizeBytes: 1}); err != nil {
		t.Fatalf("Put: %v", err)
	}
	if err := store.Delete("p1"); err != nil {
		t.Fatalf("Delete existing: %v", err)
	}
	if err := store.Delete("p1"); err != nil {
		t.Fatalf("Delete missing should be idempotent, got: %v", err)
	}
	if _, ok := store.Get("p1"); ok {
		t.Fatalf("Delete left record")
	}
}

func TestCleanupGeneratedVoiceArtifactsByAgentAndConversation(t *testing.T) {
	store := NewMemoryStore()
	if err := store.Put("voice-1", ArtifactRecord{
		Bytes:     []byte("audio-1"),
		MimeType:  "audio/wav",
		SizeBytes: 7,
		GeneratedVoice: &GeneratedVoiceArtifactMetadata{
			AgentID:              "agent-1",
			ConversationAnchorID: "anchor-1",
			TurnID:               "turn-1",
			MessageID:            "message-1",
			VoiceReference:       "preset_voice_id:voice-1",
			SpeechModelID:        "speech/model",
			RoutePolicy:          "local",
		},
	}); err != nil {
		t.Fatalf("Put voice-1: %v", err)
	}
	if err := store.Put("voice-2", ArtifactRecord{
		Bytes:     []byte("audio-2"),
		MimeType:  "audio/wav",
		SizeBytes: 7,
		GeneratedVoice: &GeneratedVoiceArtifactMetadata{
			AgentID:              "agent-1",
			ConversationAnchorID: "anchor-2",
			TurnID:               "turn-2",
			MessageID:            "message-2",
		},
	}); err != nil {
		t.Fatalf("Put voice-2: %v", err)
	}
	if err := store.Put("image-1", ArtifactRecord{
		Bytes:     []byte("image"),
		MimeType:  "image/png",
		SizeBytes: 5,
	}); err != nil {
		t.Fatalf("Put image-1: %v", err)
	}

	record, ok := store.Get("voice-1")
	if !ok || record.GeneratedVoice == nil || record.GeneratedVoice.ByteDigest == "" {
		t.Fatalf("expected generated voice metadata with byte digest, got %#v ok=%v", record.GeneratedVoice, ok)
	}
	deleted, err := store.CleanupGeneratedVoiceArtifacts(GeneratedVoiceArtifactSelector{
		AgentID:              "agent-1",
		ConversationAnchorID: "anchor-1",
	})
	if err != nil {
		t.Fatalf("CleanupGeneratedVoiceArtifacts: %v", err)
	}
	if len(deleted) != 1 || deleted[0] != "voice-1" {
		t.Fatalf("deleted mismatch: %#v", deleted)
	}
	if _, ok := store.Get("voice-1"); ok {
		t.Fatalf("voice-1 should be deleted")
	}
	if _, ok := store.Get("voice-2"); !ok {
		t.Fatalf("voice-2 should remain")
	}
	if _, ok := store.Get("image-1"); !ok {
		t.Fatalf("non-voice artifact should remain")
	}
}

func TestCleanupGeneratedVoiceArtifactsRPC(t *testing.T) {
	svc, store := newTestService(t)
	for _, artifactID := range []string{"voice-a", "voice-b"} {
		if err := store.Put(artifactID, ArtifactRecord{
			Bytes:     []byte(artifactID),
			MimeType:  "audio/wav",
			SizeBytes: int64(len(artifactID)),
			GeneratedVoice: &GeneratedVoiceArtifactMetadata{
				AgentID:              "agent-rpc",
				ConversationAnchorID: "anchor-rpc",
			},
		}); err != nil {
			t.Fatalf("Put %s: %v", artifactID, err)
		}
	}
	resp, err := svc.CleanupGeneratedVoiceArtifacts(context.Background(), &runtimev1.CleanupGeneratedVoiceArtifactsRequest{
		AgentId: "agent-rpc",
	})
	if err != nil {
		t.Fatalf("CleanupGeneratedVoiceArtifacts: %v", err)
	}
	if resp.GetDeletedCount() != 2 {
		t.Fatalf("deleted_count mismatch: got=%d", resp.GetDeletedCount())
	}
	if got := resp.GetDeletedArtifactIds(); len(got) != 2 || got[0] != "voice-a" || got[1] != "voice-b" {
		t.Fatalf("deleted ids mismatch: %#v", got)
	}
	if store.Len() != 0 {
		t.Fatalf("store should be empty after cleanup, len=%d", store.Len())
	}
}

func TestCleanupGeneratedVoiceArtifactsRejectsEmptySelector(t *testing.T) {
	svc, _ := newTestService(t)
	_, err := svc.CleanupGeneratedVoiceArtifacts(context.Background(), &runtimev1.CleanupGeneratedVoiceArtifactsRequest{})
	if err == nil {
		t.Fatalf("CleanupGeneratedVoiceArtifacts empty selector: expected error, got nil")
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_ARTIFACT_INVALID_INPUT {
		t.Fatalf("reason mismatch: got=%v ok=%v want=%v", reason, ok, runtimev1.ReasonCode_ARTIFACT_INVALID_INPUT)
	}
}
