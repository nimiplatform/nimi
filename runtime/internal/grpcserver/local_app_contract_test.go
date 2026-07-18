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

	response := (&runtimev1.OpenLocalAppSessionResponse{}).ProtoReflect().Descriptor()
	for _, forbidden := range []string{
		"local_app_principal_id", "immutable_lineage_id", "local_record_id",
		"permission_id", "permission_state", "permission_decision_id", "session_id", "session_proof",
		"launch_lease", "process_proof", "endpoint", "token", "credential",
	} {
		if response.Fields().ByName(protoreflect.Name(forbidden)) != nil {
			t.Fatalf("OpenLocalAppSessionResponse exposes private authority field %q", forbidden)
		}
	}
	for _, required := range []string{"state", "trust_class", "account_generation", "runtime_boot_epoch", "reason_code"} {
		if response.Fields().ByName(protoreflect.Name(required)) == nil {
			t.Fatalf("OpenLocalAppSessionResponse missing typed projection field %q", required)
		}
	}
}

func TestRuntimeAgentServiceDoesNotExposeRetiredLocalAppShortcuts(t *testing.T) {
	service := runtimev1.File_runtime_v1_agent_service_proto.Services().ByName("RuntimeAgentService")
	if service == nil {
		t.Fatal("RuntimeAgentService descriptor is missing")
	}
	for _, retired := range []protoreflect.Name{"ListLocalAppAgentInventory", "TranscribeLocalAppAgentAudio"} {
		if service.Methods().ByName(retired) != nil {
			t.Fatalf("retired local-app shortcut RPC %q remains publicly callable", retired)
		}
	}
}

func TestLocalAppMethodsHaveClosedFinalTransportPosture(t *testing.T) {
	desktopMethods := []string{
		"/nimi.runtime.v1.RuntimeAppService/PrepareLocalAppLaunch",
		"/nimi.runtime.v1.RuntimeAppService/BindLocalAppProcess",
		"/nimi.runtime.v1.RuntimeDevelopmentService/GetDeveloperModeStatus",
		"/nimi.runtime.v1.RuntimeDevelopmentService/GetLocalDevelopmentAuthoritySummary",
		"/nimi.runtime.v1.RuntimeDevelopmentService/SetDeveloperMode",
		"/nimi.runtime.v1.RuntimeDevelopmentService/EvaluateLocalDevelopmentProject",
		"/nimi.runtime.v1.RuntimeDevelopmentService/DecideLocalDevelopmentProject",
		"/nimi.runtime.v1.RuntimeDevelopmentService/ListLocalDevelopmentAuthorizations",
		"/nimi.runtime.v1.RuntimeDevelopmentService/ReactivateLocalDevelopmentProject",
		"/nimi.runtime.v1.RuntimeDevelopmentService/RevokeLocalDevelopmentAuthorization",
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
		protectedGetLocalAppPermissionStatusMethod,
		protectedRequestLocalAppPermissionMethod,
		protectedReadLocalAppStorageJSONMethod,
		protectedWriteLocalAppStorageJSONMethod,
		protectedRemoveLocalAppStorageJSONMethod,
	} {
		assertProtectedLocalAppMethodPolicy(t, method, protectedlocal.TransportLocalAppHost, protectedlocal.RoleLocalAppSession)
		if _, blocked := publicTransportDenial(method); !blocked {
			t.Fatalf("host local-app method %s is reachable from public transport", method)
		}
	}
	if len(protectedLocalAppStreamMethodPolicies) != 0 {
		t.Fatalf("third-party local-app transport unexpectedly admits streams: %+v", protectedLocalAppStreamMethodPolicies)
	}
}

func TestRuntimeAccountServiceDoesNotExposeRetiredOperationGrantRPCs(t *testing.T) {
	service := runtimev1.File_runtime_v1_account_proto.Services().ByName("RuntimeAccountService")
	if service == nil {
		t.Fatal("RuntimeAccountService descriptor is missing")
	}
	for _, retired := range []protoreflect.Name{
		"GetLocalAppGrantStatus",
		"RequestLocalAppGrant",
		"DecideLocalAppGrant",
		"RevokeLocalAppGrant",
	} {
		if service.Methods().ByName(retired) != nil {
			t.Fatalf("retired operation-grant RPC %q remains publicly callable", retired)
		}
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
