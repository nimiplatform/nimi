package app

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"path/filepath"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appstorage"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	runtimeartifact "github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type adoptionPatternReader struct{}

func (adoptionPatternReader) Read(target []byte) (int, error) {
	for index := range target {
		target[index] = byte((index*29 + 7) % 251)
	}
	return len(target), nil
}

func TestLocalAppArtifactAdoptionStreamsLargeVerifiedSourceAndDetachesLifecycle(t *testing.T) {
	artifacts, err := runtimeartifact.NewDiskStore(filepath.Join(t.TempDir(), "runtime-artifacts"))
	if err != nil {
		t.Fatal(err)
	}
	sizeBytes := int64(runtimeartifact.MaxInlineBytes + 1024*1024 + 19)
	if err := artifacts.PutStream(context.Background(), "large-video", runtimeartifact.ArtifactRecord{
		MimeType: "video/mp4",
		Owner: &runtimeartifact.ArtifactOwner{
			SubjectUserID: "account-a", RegisteredAppSubject: "subject-a", AppID: "producer-metadata-only",
		},
	}, io.NopCloser(io.LimitReader(adoptionPatternReader{}, sizeBytes))); err != nil {
		t.Fatal(err)
	}
	service := newTestService(
		WithAppStorageDataRoot(t.TempDir()),
		WithLocalDevelopmentAuthority(nil, nil, nil, artifacts),
	)
	response, err := service.AdoptLocalAppArtifact(
		localAppAdoptionTestContext(context.Background(), "account-a", "subject-a", "runtime.consume"),
		&runtimev1.AdoptLocalAppArtifactRequest{ArtifactId: "large-video", RelativePath: "media/large.mp4"},
	)
	if err != nil {
		t.Fatal(err)
	}
	sourceMetadata, ok := artifacts.Stat("large-video")
	asset := response.GetAsset()
	if !ok || asset.GetMediaType() != sourceMetadata.MimeType || asset.GetSizeBytes() != sourceMetadata.SizeBytes || asset.GetSha256() != sourceMetadata.ContentSHA256 {
		t.Fatalf("adopted asset=%+v source=%+v", asset, sourceMetadata)
	}
	if err := artifacts.Delete("large-video"); err != nil {
		t.Fatal(err)
	}
	assetStore, err := service.localAppAssets()
	if err != nil {
		t.Fatal(err)
	}
	opened, err := assetStore.Open(context.Background(), appstorage.ManagedOwner{AccountID: "account-a", RegisteredAppSubject: "subject-a"}, "media/large.mp4")
	if err != nil {
		t.Fatal(err)
	}
	observed, readErr := io.Copy(io.Discard, opened.Body)
	closeErr := opened.Body.Close()
	if readErr != nil || closeErr != nil || observed != sizeBytes {
		t.Fatalf("detached asset bytes=%d read=%v close=%v", observed, readErr, closeErr)
	}
}

func TestLocalAppArtifactAdoptionUnavailableClassHasNoOracleOrTargetMutation(t *testing.T) {
	artifacts := runtimeartifact.NewMemoryStore()
	put := func(id, accountID, subject string) {
		t.Helper()
		if err := artifacts.Put(id, runtimeartifact.ArtifactRecord{
			Bytes: []byte("payload"), MimeType: "audio/wav",
			Owner: &runtimeartifact.ArtifactOwner{SubjectUserID: accountID, RegisteredAppSubject: subject, AppID: "any-producer"},
		}); err != nil {
			t.Fatal(err)
		}
	}
	put("foreign-account", "account-b", "subject-a")
	put("foreign-subject", "account-a", "subject-b")
	put("historical-unbound", "account-a", "")
	service := newTestService(WithAppStorageDataRoot(t.TempDir()), WithLocalDevelopmentAuthority(nil, nil, nil, artifacts))
	for _, artifactID := range []string{"missing", "foreign-account", "foreign-subject", "historical-unbound"} {
		t.Run(artifactID, func(t *testing.T) {
			target := "rejected/" + artifactID + ".bin"
			_, err := service.AdoptLocalAppArtifact(
				localAppAdoptionTestContext(context.Background(), "account-a", "subject-a", "runtime.consume"),
				&runtimev1.AdoptLocalAppArtifactRequest{ArtifactId: artifactID, RelativePath: target},
			)
			assertAdoptionReason(t, err, codes.FailedPrecondition, runtimev1.ReasonCode_APP_STORAGE_ARTIFACT_UNAVAILABLE)
			assertAdoptionTargetAbsent(t, service, target)
		})
	}

	_, err := service.AdoptLocalAppArtifact(
		localAppAdoptionTestContext(context.Background(), "account-a", "subject-a", ""),
		&runtimev1.AdoptLocalAppArtifactRequest{ArtifactId: "missing", RelativePath: "denied.bin"},
	)
	assertAdoptionReason(t, err, codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
}

func TestLocalAppArtifactAdoptionCancelQuotaAndIntegrityLeaveNoTarget(t *testing.T) {
	artifacts := runtimeartifact.NewMemoryStore()
	if err := artifacts.Put("payload", runtimeartifact.ArtifactRecord{
		Bytes: []byte("payload"), MimeType: "application/octet-stream",
		Owner: &runtimeartifact.ArtifactOwner{SubjectUserID: "account-a", RegisteredAppSubject: "subject-a", AppID: "producer"},
	}); err != nil {
		t.Fatal(err)
	}
	quotaService := newTestService(
		WithAppStorageDataRoot(t.TempDir()),
		WithLocalAppAssetPolicy(appstorage.AssetPolicy{MaxObjectBytes: 10, MaxOwnerBytes: 4, MaxOwnerObjects: 1, MinFreeBytes: 1}),
		WithLocalDevelopmentAuthority(nil, nil, nil, artifacts),
	)
	_, err := quotaService.AdoptLocalAppArtifact(
		localAppAdoptionTestContext(context.Background(), "account-a", "subject-a", "runtime.consume"),
		&runtimev1.AdoptLocalAppArtifactRequest{ArtifactId: "payload", RelativePath: "quota.bin"},
	)
	assertAdoptionReason(t, err, codes.ResourceExhausted, runtimev1.ReasonCode_APP_STORAGE_QUOTA_EXCEEDED)
	assertAdoptionTargetAbsent(t, quotaService, "quota.bin")

	canceledContext, cancel := context.WithCancel(context.Background())
	cancel()
	service := newTestService(WithAppStorageDataRoot(t.TempDir()), WithLocalDevelopmentAuthority(nil, nil, nil, artifacts))
	_, err = service.AdoptLocalAppArtifact(
		localAppAdoptionTestContext(canceledContext, "account-a", "subject-a", "runtime.consume"),
		&runtimev1.AdoptLocalAppArtifactRequest{ArtifactId: "payload", RelativePath: "canceled.bin"},
	)
	if status.Code(err) != codes.Canceled {
		t.Fatalf("cancel err=%v", err)
	}
	assertAdoptionTargetAbsent(t, service, "canceled.bin")

	corrupt := corruptAdoptionArtifactStore{}
	corruptService := newTestService(WithAppStorageDataRoot(t.TempDir()), WithLocalDevelopmentAuthority(nil, nil, nil, corrupt))
	_, err = corruptService.AdoptLocalAppArtifact(
		localAppAdoptionTestContext(context.Background(), "account-a", "subject-a", "runtime.consume"),
		&runtimev1.AdoptLocalAppArtifactRequest{ArtifactId: "corrupt", RelativePath: "corrupt.bin"},
	)
	assertAdoptionReason(t, err, codes.FailedPrecondition, runtimev1.ReasonCode_APP_STORAGE_ARTIFACT_UNAVAILABLE)
	assertAdoptionTargetAbsent(t, corruptService, "corrupt.bin")
}

func localAppAdoptionTestContext(parent context.Context, accountID, subject, capability string) context.Context {
	return accountservice.ContextWithAuthorizedLocalAppDecision(parent, accountservice.LocalAppCallerDecision{
		AccountID: accountID, RegisteredAppSubject: subject,
		Operation: accountservice.LocalAppOperationArtifactAdoptToStorage, AuthorityClass: localappop.AuthorityClassAppAccess,
		OperationCapability: capability, ExpiresAt: time.Now().Add(time.Minute),
	})
}

func assertAdoptionReason(t *testing.T, err error, code codes.Code, reason runtimev1.ReasonCode) {
	t.Helper()
	gotReason, _ := grpcerr.ExtractReasonCode(err)
	if status.Code(err) != code || gotReason != reason {
		t.Fatalf("adoption failure code=%s reason=%s err=%v", status.Code(err), gotReason, err)
	}
}

func assertAdoptionTargetAbsent(t *testing.T, service *Service, relativePath string) {
	t.Helper()
	store, err := service.localAppAssets()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Stat(context.Background(), appstorage.ManagedOwner{AccountID: "account-a", RegisteredAppSubject: "subject-a"}, relativePath); !errors.Is(err, appstorage.ErrAssetNotFound) {
		t.Fatalf("rejected adoption target %q exists or failed unexpectedly: %v", relativePath, err)
	}
}

type corruptAdoptionArtifactStore struct{}

func (corruptAdoptionArtifactStore) Put(string, runtimeartifact.ArtifactRecord) error { return nil }
func (corruptAdoptionArtifactStore) Get(string) (runtimeartifact.ArtifactRecord, bool) {
	return runtimeartifact.ArtifactRecord{}, false
}
func (corruptAdoptionArtifactStore) PutStream(context.Context, string, runtimeartifact.ArtifactRecord, io.ReadCloser) error {
	return nil
}
func (corruptAdoptionArtifactStore) Stat(string) (runtimeartifact.ArtifactRecord, bool) {
	return runtimeartifact.ArtifactRecord{}, false
}
func (corruptAdoptionArtifactStore) Open(context.Context, string) (*runtimeartifact.ArtifactSource, bool) {
	expected := sha256.Sum256([]byte("expected"))
	return &runtimeartifact.ArtifactSource{
		Record: runtimeartifact.ArtifactRecord{
			MimeType: "application/octet-stream", SizeBytes: int64(len("expected")),
			ContentSHA256: "sha256:" + hex.EncodeToString(expected[:]),
			Owner:         &runtimeartifact.ArtifactOwner{SubjectUserID: "account-a", RegisteredAppSubject: "subject-a", AppID: "producer"},
		},
		Body: &adoptionReadSeekCloser{Reader: *bytes.NewReader([]byte("tampered"))},
	}, true
}
func (corruptAdoptionArtifactStore) Delete(string) error { return nil }
func (corruptAdoptionArtifactStore) CleanupGeneratedVoiceArtifacts(runtimeartifact.GeneratedVoiceArtifactSelector) ([]string, error) {
	return nil, nil
}
func (corruptAdoptionArtifactStore) Len() int { return 1 }

type adoptionReadSeekCloser struct{ bytes.Reader }

func (*adoptionReadSeekCloser) Close() error { return nil }
