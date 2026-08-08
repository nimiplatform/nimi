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

func localAppArtifactReadContext() context.Context {
	return localAppScenarioDecisionContext(accountservice.LocalAppOperationArtifactRead, localappop.AppOperationIDArtifactRead)
}

func putLocalAppArtifactForTest(t *testing.T, svc *Service, artifactID string, owner *runtimeartifact.ArtifactOwner, payload []byte) {
	t.Helper()
	if err := svc.runtimeArtifacts.Put(artifactID, runtimeartifact.ArtifactRecord{
		Bytes:    payload,
		MimeType: "image/png",
		Owner:    owner,
	}); err != nil {
		t.Fatalf("put artifact: %v", err)
	}
}

func TestReadLocalAppArtifactReturnsOwnedInlineBytes(t *testing.T) {
	svc := newTestService(nil)
	putLocalAppArtifactForTest(t, svc, "artifact-1", &runtimeartifact.ArtifactOwner{
		SubjectUserID: "account-1", AppID: "nimi.realm-persona-studio",
	}, []byte("payload"))
	response, err := svc.ReadLocalAppArtifact(localAppArtifactReadContext(), &runtimev1.ReadLocalAppArtifactRequest{ArtifactId: "artifact-1"})
	if err != nil {
		t.Fatalf("ReadLocalAppArtifact: %v", err)
	}
	if string(response.GetBytes()) != "payload" || response.GetMimeType() != "image/png" ||
		response.GetSizeBytes() != int64(len("payload")) {
		t.Fatalf("artifact response = %+v", response)
	}
}

func TestReadLocalAppArtifactFailsClosedOnWrongDecisionAndBadID(t *testing.T) {
	svc := &Service{}
	_, err := svc.ReadLocalAppArtifact(context.Background(), &runtimev1.ReadLocalAppArtifactRequest{ArtifactId: "artifact-1"})
	assertLocalAppTextCandidateError(t, err, codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)

	_, err = svc.ReadLocalAppArtifact(localAppArtifactReadContext(), &runtimev1.ReadLocalAppArtifactRequest{ArtifactId: " padded "})
	assertLocalAppTextCandidateError(t, err, codes.InvalidArgument, runtimev1.ReasonCode_ARTIFACT_INVALID_INPUT)
}

func TestReadLocalAppArtifactRejectsMissingCrossOwnerAndOversize(t *testing.T) {
	svc := newTestService(nil)
	putLocalAppArtifactForTest(t, svc, "artifact-other-app", &runtimeartifact.ArtifactOwner{
		SubjectUserID: "account-1", AppID: "other-app",
	}, []byte("payload"))
	putLocalAppArtifactForTest(t, svc, "artifact-no-owner", nil, []byte("payload"))
	putLocalAppArtifactForTest(t, svc, "artifact-oversize", &runtimeartifact.ArtifactOwner{
		SubjectUserID: "account-1", AppID: "nimi.realm-persona-studio",
	}, make([]byte, runtimeartifact.MaxInlineBytes+1))

	_, err := svc.ReadLocalAppArtifact(localAppArtifactReadContext(), &runtimev1.ReadLocalAppArtifactRequest{ArtifactId: "artifact-missing"})
	assertLocalAppTextCandidateError(t, err, codes.NotFound, runtimev1.ReasonCode_ARTIFACT_NOT_FOUND)

	_, err = svc.ReadLocalAppArtifact(localAppArtifactReadContext(), &runtimev1.ReadLocalAppArtifactRequest{ArtifactId: "artifact-other-app"})
	assertLocalAppTextCandidateError(t, err, codes.PermissionDenied, runtimev1.ReasonCode_ARTIFACT_FORBIDDEN)

	_, err = svc.ReadLocalAppArtifact(localAppArtifactReadContext(), &runtimev1.ReadLocalAppArtifactRequest{ArtifactId: "artifact-no-owner"})
	assertLocalAppTextCandidateError(t, err, codes.PermissionDenied, runtimev1.ReasonCode_ARTIFACT_FORBIDDEN)

	_, err = svc.ReadLocalAppArtifact(localAppArtifactReadContext(), &runtimev1.ReadLocalAppArtifactRequest{ArtifactId: "artifact-oversize"})
	assertLocalAppTextCandidateError(t, err, codes.ResourceExhausted, runtimev1.ReasonCode_ARTIFACT_TOO_LARGE)
}
