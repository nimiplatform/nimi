package ai

import (
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"google.golang.org/grpc/codes"
)

func localAppArtifactUploadContext() context.Context {
	return localAppScenarioDecisionContext(accountservice.LocalAppOperationArtifactUpload, localappop.AppOperationIDArtifactUpload)
}

func TestUploadLocalAppArtifactStoresSessionOwnerCustody(t *testing.T) {
	svc := newTestService(nil)
	payload := []byte("image-payload")
	response, err := svc.UploadLocalAppArtifact(localAppArtifactUploadContext(), &runtimev1.UploadLocalAppArtifactRequest{
		Bytes: payload, MimeType: " IMAGE/PNG ",
	})
	if err != nil {
		t.Fatalf("UploadLocalAppArtifact: %v", err)
	}
	if response.GetArtifactId() == "" || response.GetMimeType() != "image/png" || response.GetSizeBytes() != int64(len(payload)) {
		t.Fatalf("upload response = %+v", response)
	}
	record, ok := svc.runtimeArtifacts.Get(response.GetArtifactId())
	if !ok || record.Owner == nil || record.Owner.AppID != "nimi.realm-persona-studio" || record.Owner.SubjectUserID != "account-1" {
		t.Fatalf("stored owner = %+v, present=%v", record.Owner, ok)
	}
	read, err := svc.ReadLocalAppArtifact(localAppArtifactReadContext(), &runtimev1.ReadLocalAppArtifactRequest{ArtifactId: response.GetArtifactId()})
	if err != nil || string(read.GetBytes()) != string(payload) {
		t.Fatalf("owner read = %+v, error=%v", read, err)
	}
	wrongOwner := accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{
		AccountID: "account-1", AppID: "other-app", RegisteredAppSubject: "principal-1",
		Operation: accountservice.LocalAppOperationArtifactRead, AuthorityClass: localappop.AuthorityClassAppAccess,
		OperationCapability: localappop.AppOperationIDArtifactRead,
	})
	_, err = svc.ReadLocalAppArtifact(wrongOwner, &runtimev1.ReadLocalAppArtifactRequest{ArtifactId: response.GetArtifactId()})
	assertLocalAppTextCandidateError(t, err, codes.PermissionDenied, runtimev1.ReasonCode_ARTIFACT_FORBIDDEN)
}

func TestUploadLocalAppArtifactRejectsDecisionMimeAndSizeViolations(t *testing.T) {
	svc := newTestService(nil)
	_, err := svc.UploadLocalAppArtifact(context.Background(), &runtimev1.UploadLocalAppArtifactRequest{Bytes: []byte{1}, MimeType: "image/png"})
	assertLocalAppTextCandidateError(t, err, codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)

	_, err = svc.UploadLocalAppArtifact(localAppArtifactUploadContext(), &runtimev1.UploadLocalAppArtifactRequest{Bytes: []byte{1}, MimeType: "video/mp4"})
	assertLocalAppTextCandidateError(t, err, codes.InvalidArgument, runtimev1.ReasonCode_ARTIFACT_UPLOAD_MIME_UNSUPPORTED)

	_, err = svc.UploadLocalAppArtifact(localAppArtifactUploadContext(), &runtimev1.UploadLocalAppArtifactRequest{Bytes: make([]byte, runtimeartifact.MaxInlineBytes+1), MimeType: "image/png"})
	assertLocalAppTextCandidateError(t, err, codes.ResourceExhausted, runtimev1.ReasonCode_AI_ARTIFACT_UPLOAD_TOO_LARGE)

	_, err = svc.UploadLocalAppArtifact(localAppArtifactUploadContext(), &runtimev1.UploadLocalAppArtifactRequest{MimeType: "image/png"})
	assertLocalAppTextCandidateError(t, err, codes.InvalidArgument, runtimev1.ReasonCode_AI_ARTIFACT_UPLOAD_INVALID)
}
