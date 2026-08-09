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

func localAppArtifactContextForOwner(appID string, subject string) context.Context {
	return accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{
		AccountID: "account-1", AppID: appID, RegisteredAppSubject: subject,
		Operation: accountservice.LocalAppOperationArtifactRead, AuthorityClass: localappop.AuthorityClassAppAccess,
		OperationCapability: localappop.AppOperationIDArtifactRead,
	})
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
		SubjectUserID: "account-1", RegisteredAppSubject: "principal-1", AppID: "nimi.realm-persona-studio",
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

func TestLocalAppArtifactAuthorizationDoesNotUseProducerAppID(t *testing.T) {
	svc := newTestService(nil)
	putLocalAppArtifactForTest(t, svc, "artifact-app-metadata", &runtimeartifact.ArtifactOwner{
		SubjectUserID: "account-1", RegisteredAppSubject: "principal-1", AppID: "original-producer-app",
	}, []byte("payload"))
	response, err := svc.ReadLocalAppArtifact(localAppArtifactContextForOwner("different-session-app-metadata", "principal-1"),
		&runtimev1.ReadLocalAppArtifactRequest{ArtifactId: "artifact-app-metadata"})
	if err != nil || string(response.GetBytes()) != "payload" {
		t.Fatalf("AppID incorrectly authorized artifact read: response=%+v err=%v", response, err)
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
		SubjectUserID: "account-1", RegisteredAppSubject: "principal-2", AppID: "nimi.realm-persona-studio",
	}, []byte("payload"))
	putLocalAppArtifactForTest(t, svc, "artifact-historical-unbound", &runtimeartifact.ArtifactOwner{
		SubjectUserID: "account-1", AppID: "nimi.realm-persona-studio",
	}, []byte("payload"))
	putLocalAppArtifactForTest(t, svc, "artifact-no-owner", nil, []byte("payload"))
	putLocalAppArtifactForTest(t, svc, "artifact-oversize", &runtimeartifact.ArtifactOwner{
		SubjectUserID: "account-1", RegisteredAppSubject: "principal-1", AppID: "producer-renamed",
	}, make([]byte, runtimeartifact.MaxInlineBytes+1))

	_, err := svc.ReadLocalAppArtifact(localAppArtifactReadContext(), &runtimev1.ReadLocalAppArtifactRequest{ArtifactId: "artifact-missing"})
	assertLocalAppTextCandidateError(t, err, codes.PermissionDenied, runtimev1.ReasonCode_ARTIFACT_FORBIDDEN)

	_, err = svc.ReadLocalAppArtifact(localAppArtifactReadContext(), &runtimev1.ReadLocalAppArtifactRequest{ArtifactId: "artifact-other-app"})
	assertLocalAppTextCandidateError(t, err, codes.PermissionDenied, runtimev1.ReasonCode_ARTIFACT_FORBIDDEN)

	_, err = svc.ReadLocalAppArtifact(localAppArtifactReadContext(), &runtimev1.ReadLocalAppArtifactRequest{ArtifactId: "artifact-no-owner"})
	assertLocalAppTextCandidateError(t, err, codes.PermissionDenied, runtimev1.ReasonCode_ARTIFACT_FORBIDDEN)

	_, err = svc.ReadLocalAppArtifact(localAppArtifactReadContext(), &runtimev1.ReadLocalAppArtifactRequest{ArtifactId: "artifact-historical-unbound"})
	assertLocalAppTextCandidateError(t, err, codes.PermissionDenied, runtimev1.ReasonCode_ARTIFACT_FORBIDDEN)

	_, err = svc.ReadLocalAppArtifact(localAppArtifactReadContext(), &runtimev1.ReadLocalAppArtifactRequest{ArtifactId: "artifact-oversize"})
	assertLocalAppTextCandidateError(t, err, codes.ResourceExhausted, runtimev1.ReasonCode_ARTIFACT_TOO_LARGE)
}

func TestLocalVideoArtifactRefUsesSharedLocalAppOwnerAuthorizer(t *testing.T) {
	svc := newTestService(nil)
	putLocalAppArtifactForTest(t, svc, "artifact-input", &runtimeartifact.ArtifactOwner{
		SubjectUserID: "account-1", RegisteredAppSubject: "principal-1", AppID: "producer-app",
	}, []byte("image-payload"))
	putLocalAppArtifactForTest(t, svc, "artifact-input-foreign", &runtimeartifact.ArtifactOwner{
		SubjectUserID: "account-1", RegisteredAppSubject: "principal-2", AppID: "producer-app",
	}, []byte("image-payload"))
	putLocalAppArtifactForTest(t, svc, "artifact-input-unbound", &runtimeartifact.ArtifactOwner{
		SubjectUserID: "account-1", AppID: "producer-app",
	}, []byte("image-payload"))
	item := func(artifactID string) *runtimev1.VideoContentItem {
		return &runtimev1.VideoContentItem{
			Type:        runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_ARTIFACT_REF,
			Role:        runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_FIRST_FRAME,
			ArtifactRef: &runtimev1.VideoContentArtifactRef{ArtifactId: artifactID},
		}
	}
	ctx := localAppArtifactContextForOwner("non-authorizing-app-id", "principal-1")
	resolved, err := svc.resolveLocalVideoArtifactInput(ctx, &runtimev1.ScenarioRequestHead{AppId: "non-authorizing-app-id", SubjectUserId: "account-1"}, item("artifact-input"))
	if err != nil || string(resolved.ImageBytes) != "image-payload" {
		t.Fatalf("resolve owned input=%+v err=%v", resolved, err)
	}
	for _, artifactID := range []string{"artifact-missing", "artifact-input-foreign", "artifact-input-unbound"} {
		_, err := svc.resolveLocalVideoArtifactInput(ctx, &runtimev1.ScenarioRequestHead{AppId: "non-authorizing-app-id", SubjectUserId: "account-1"}, item(artifactID))
		assertLocalAppTextCandidateError(t, err, codes.PermissionDenied, runtimev1.ReasonCode_ARTIFACT_FORBIDDEN)
	}
}
