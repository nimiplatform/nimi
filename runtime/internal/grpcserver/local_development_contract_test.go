package grpcserver

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/reflect/protoreflect"
)

func TestLocalDevelopmentWireContractKeepsTechnicalSessionMaterialOutOfMessages(t *testing.T) {
	request := (&runtimev1.OpenLocalDevelopmentAppSessionRequest{}).ProtoReflect().Descriptor()
	if request.Fields().Len() != 0 {
		t.Fatalf("OpenLocalDevelopmentAppSessionRequest must be empty, got %d caller-selectable fields", request.Fields().Len())
	}

	response := (&runtimev1.OpenLocalDevelopmentAppSessionResponse{}).ProtoReflect().Descriptor()
	for _, forbidden := range []string{"session_id", "session_proof", "session_token", "launch_ticket", "credential", "token"} {
		if response.Fields().ByName(protoreflectName(forbidden)) != nil {
			t.Fatalf("OpenLocalDevelopmentAppSessionResponse exposes forbidden technical material field %q", forbidden)
		}
	}
	for _, required := range []string{"state", "app_id", "bootstrap_artifact_id", "expires_at", "reason_code"} {
		if response.Fields().ByName(protoreflectName(required)) == nil {
			t.Fatalf("OpenLocalDevelopmentAppSessionResponse missing typed host status field %q", required)
		}
	}
}

func TestLocalDevelopmentMethodsHaveClosedTransportPosture(t *testing.T) {
	desktopMethods := []string{
		"/nimi.runtime.v1.RuntimeDevelopmentService/EvaluateLocalDevelopmentProject",
		"/nimi.runtime.v1.RuntimeDevelopmentService/DecideLocalDevelopmentProject",
		"/nimi.runtime.v1.RuntimeDevelopmentService/ListLocalDevelopmentAuthorizations",
		"/nimi.runtime.v1.RuntimeDevelopmentService/RevokeLocalDevelopmentAuthorization",
		"/nimi.runtime.v1.RuntimeDevelopmentService/PrepareLocalDevelopmentLaunch",
		"/nimi.runtime.v1.RuntimeDevelopmentService/BindLocalDevelopmentHostProcess",
		"/nimi.runtime.v1.RuntimeDevelopmentService/EndLocalDevelopmentRun",
	}
	for _, method := range desktopMethods {
		if !protectedDesktopUnaryMethodAllowed(method) {
			t.Fatalf("Desktop-owned local-development method %s is not admitted on protected Desktop transport", method)
		}
		if _, blocked := publicTransportDenial(method); !blocked {
			t.Fatalf("local-development method %s is reachable from public transport", method)
		}
	}

	hostMethods := []string{
		"/nimi.runtime.v1.RuntimeDevelopmentService/OpenLocalDevelopmentAppSession",
		"/nimi.runtime.v1.RuntimeDevelopmentService/GetLocalDevelopmentSessionStatus",
	}
	for _, method := range hostMethods {
		if !protectedInstalledUnaryMethodAllowed(method) {
			t.Fatalf("host local-development method %s is not admitted on verified native host transport", method)
		}
		if _, blocked := publicTransportDenial(method); !blocked {
			t.Fatalf("local-development host method %s is reachable from public transport", method)
		}
	}
	for _, method := range desktopMethods {
		if protectedInstalledUnaryMethodAllowed(method) {
			t.Fatalf("Desktop lifecycle method %s leaked onto app-host transport", method)
		}
	}
}

func protoreflectName(value string) protoreflect.Name {
	return protoreflect.Name(value)
}
