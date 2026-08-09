package grpcserver

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"google.golang.org/protobuf/reflect/protoreflect"
)

func TestLocalAppSessionWireKeepsPrivateAuthorityOutOfMessages(t *testing.T) {
	request := (&runtimev1.OpenLocalAppSessionRequest{}).ProtoReflect().Descriptor()
	if request.Fields().Len() != 0 {
		t.Fatalf("OpenLocalAppSessionRequest must be empty, got %d caller-selectable fields", request.Fields().Len())
	}
	renewRequest := (&runtimev1.RenewLocalAppSessionRequest{}).ProtoReflect().Descriptor()
	if renewRequest.Fields().Len() != 0 {
		t.Fatalf("RenewLocalAppSessionRequest must be empty, got %d caller-selectable fields", renewRequest.Fields().Len())
	}

	response := (&runtimev1.OpenLocalAppSessionResponse{}).ProtoReflect().Descriptor()
	for _, forbidden := range []string{
		"local_app_principal_id", "immutable_lineage_id", "local_record_id",
		"permission_id", "permission_state", "permission_decision_id", "session_id", "session_proof",
		"launch_lease", "process_proof", "endpoint", "token", "credential", "subject", "account",
		"snapshot", "generation", "trust_class", "account_generation", "runtime_boot_epoch", "peer_proof",
	} {
		if response.Fields().ByName(protoreflect.Name(forbidden)) != nil {
			t.Fatalf("OpenLocalAppSessionResponse exposes private authority field %q", forbidden)
		}
	}
	for _, required := range []string{"state", "reason_code", "current_user", "current_user_reason_code"} {
		if response.Fields().ByName(protoreflect.Name(required)) == nil {
			t.Fatalf("OpenLocalAppSessionResponse missing typed projection field %q", required)
		}
	}
	if response.Fields().Len() != 4 {
		t.Fatalf("OpenLocalAppSessionResponse fields = %d, want session posture plus isolated Current User posture", response.Fields().Len())
	}
	currentUser := (&runtimev1.CurrentUserDisplayProjection{}).ProtoReflect().Descriptor()
	if currentUser.Fields().Len() != 3 {
		t.Fatalf("CurrentUserDisplayProjection fields = %d, want exact handle/display_name/avatar_url", currentUser.Fields().Len())
	}
	for _, required := range []string{"handle", "display_name", "avatar_url"} {
		if currentUser.Fields().ByName(protoreflect.Name(required)) == nil {
			t.Fatalf("CurrentUserDisplayProjection missing %q", required)
		}
	}
}

func TestLocalAppMethodsHaveClosedFinalTransportPosture(t *testing.T) {
	desktopMethods := []string{
		"/nimi.runtime.v1.RuntimeAppService/PrepareLocalAppLaunch",
		"/nimi.runtime.v1.RuntimeAppService/BindLocalAppProcess",
		"/nimi.runtime.v1.RuntimeDevelopmentService/GetDeveloperModeStatus",
		"/nimi.runtime.v1.RuntimeDevelopmentService/SetDeveloperMode",
		"/nimi.runtime.v1.RuntimeDevelopmentService/RegisterLocalDevelopmentProject",
		"/nimi.runtime.v1.RuntimeDevelopmentService/ListLocalDevelopmentRegistrations",
		"/nimi.runtime.v1.RuntimeDevelopmentService/RemoveLocalDevelopmentRegistration",
		"/nimi.runtime.v1.RuntimeDevelopmentService/EndLocalDevelopmentRun",
	}
	for _, method := range desktopMethods {
		if role, allowed := protectedDesktopMethodRole(method); !allowed || role != protectedlocal.RoleLocalAppControl {
			t.Fatalf("Desktop local-app method %s role=(%q,%v)", method, role, allowed)
		}
		if _, blocked := publicTransportDenial(method); !blocked {
			t.Fatalf("Desktop local-app method %s is reachable from public transport", method)
		}
		if protectedLocalAppUnaryMethodAllowed(method) || protectedLocalAppStreamMethodAllowed(method) {
			t.Fatalf("Desktop local-app control method %s leaked onto the app-host transport", method)
		}
	}

	assertProtectedLocalAppMethodPolicy(t, protectedOpenLocalAppSessionMethod, protectedlocal.TransportLocalAppBootstrap, protectedlocal.RoleLocalAppProcess)
	for _, method := range []string{
		protectedRenewLocalAppSessionMethod,
		protectedReadLocalAppStorageJSONMethod,
		protectedWriteLocalAppStorageJSONMethod,
		protectedRemoveLocalAppStorageJSONMethod,
		protectedStatLocalAppAssetMethod,
		protectedListLocalAppAssetsMethod,
		protectedRemoveLocalAppAssetMethod,
		protectedMoveLocalAppAssetMethod,
		protectedAdoptLocalAppArtifactMethod,
		protectedOpenConversationMethod,
		protectedSendConversationTurnMethod,
		protectedConversationSnapshotMethod,
		protectedGetSharedAIConfigMethod,
		protectedOverwriteSharedAIConfigMethod,
		protectedAutonomySnapshotMethod,
		protectedUpdateAutonomyMethod,
		protectedPresentationSnapshotMethod,
		protectedCommitPresentationMethod,
	} {
		assertProtectedLocalAppMethodPolicy(t, method, protectedlocal.TransportLocalAppHost, protectedlocal.RoleLocalAppSession)
		if _, blocked := publicTransportDenial(method); !blocked {
			t.Fatalf("host local-app method %s is reachable from public transport", method)
		}
	}
	assertProtectedLocalAppStreamMethodPolicy(t, protectedSubscribeConversationMethod, protectedlocal.TransportLocalAppHost, protectedlocal.RoleLocalAppSession)
	assertProtectedLocalAppStreamMethodPolicy(t, protectedStreamTextTurnMethod, protectedlocal.TransportLocalAppHost, protectedlocal.RoleLocalAppSession)
	assertProtectedLocalAppStreamMethodPolicy(t, protectedSubscribeScenarioJobMethod, protectedlocal.TransportLocalAppHost, protectedlocal.RoleLocalAppSession)
	assertProtectedLocalAppStreamMethodPolicy(t, protectedWriteLocalAppAssetMethod, protectedlocal.TransportLocalAppHost, protectedlocal.RoleLocalAppSession)
	assertProtectedLocalAppStreamMethodPolicy(t, protectedReadLocalAppAssetMethod, protectedlocal.TransportLocalAppHost, protectedlocal.RoleLocalAppSession)
	for _, method := range []string{protectedWriteLocalAppAssetMethod, protectedReadLocalAppAssetMethod} {
		if _, blocked := publicTransportDenial(method); !blocked {
			t.Fatalf("host local-app stream %s is reachable from public transport", method)
		}
	}
	for _, method := range []string{
		protectedExecuteLocalAppScenarioMethod,
		protectedSubmitScenarioJobMethod,
		protectedGetScenarioJobMethod,
		protectedCancelScenarioJobMethod,
		protectedReadLocalAppArtifactMethod,
		protectedUploadLocalAppArtifactMethod,
		protectedListLocalAppVoiceAssetsMethod,
	} {
		assertProtectedLocalAppMethodPolicy(t, method, protectedlocal.TransportLocalAppHost, protectedlocal.RoleLocalAppSession)
	}
}

func assertProtectedLocalAppStreamMethodPolicy(t testing.TB, method string, transport protectedlocal.TransportClass, role protectedlocal.OriginRole) {
	t.Helper()
	policy, ok := protectedLocalAppStreamMethodPolicies[method]
	if !ok {
		t.Fatalf("missing local-app stream policy for %s", method)
	}
	if policy.transport != transport || policy.role != role {
		t.Fatalf("local-app stream policy for %s = %+v, want transport=%q role=%q", method, policy, transport, role)
	}
}

func assertProtectedLocalAppMethodPolicy(t testing.TB, method string, transport protectedlocal.TransportClass, role protectedlocal.OriginRole) {
	t.Helper()
	policy, ok := protectedLocalAppUnaryMethodPolicies[method]
	if !ok {
		t.Fatalf("missing local-app policy for %s", method)
	}
	if policy.transport != transport || policy.role != role {
		t.Fatalf("local-app policy for %s = %+v, want transport=%q role=%q", method, policy, transport, role)
	}
}
