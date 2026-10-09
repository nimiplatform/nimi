package integration

import (
	"encoding/base64"
	"net/http"
	"os"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	statuspb "google.golang.org/genproto/googleapis/rpc/status"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
)

func roundTripOwnerFailure(t *testing.T, err error, code codes.Code, reason runtimev1.ReasonCode, integrationReason string) *statuspb.Status {
	t.Helper()
	wire, marshalErr := proto.Marshal(status.Convert(err).Proto())
	if marshalErr != nil {
		t.Fatal(marshalErr)
	}
	var decoded statuspb.Status
	if decodeErr := proto.Unmarshal(wire, &decoded); decodeErr != nil {
		t.Fatal(decodeErr)
	}
	carried := status.FromProto(&decoded).Err()
	if status.Code(carried) != code {
		t.Fatalf("RPC code changed: %v", carried)
	}
	if actual, typed := grpcerr.ExtractReasonCode(carried); !typed || actual != reason {
		t.Fatalf("owner refusal lost its typed reason: %v", carried)
	}
	if metadata, typed := grpcerr.ExtractReasonMetadata(carried); !typed || metadata["integration_reason"] != integrationReason {
		t.Fatalf("owner refusal lost its bounded integration reason: %v", carried)
	}
	return &decoded
}

func TestInvalidOneBotSetupCarriesOwnerRejectionBeforeEffects(t *testing.T) {
	s := newIntegrationTestService(t, testRoundTripper(func(*http.Request) (*http.Response, error) {
		t.Fatal("invalid configuration dispatched a provider request")
		return nil, nil
	}))
	for _, config := range []*runtimev1.IntegrationOneBotV11Config{
		{Listener: "127.0.0.1:0", SelfId: "12345"},
		{Listener: "127.0.0.1:6700", SelfId: "invalid-account"},
	} {
		response, err := s.StartIntegrationConnectionSetup(desktopIntegrationContext(t, localappop.OperationIntegrationConnectionSetupStart), &runtimev1.StartIntegrationConnectionSetupRequest{
			Adapter: "onebot-v11", DisplayName: "Invalid configuration regression",
			Config: &runtimev1.IntegrationConnectionConfig{OnebotV11: config},
		})
		if response != nil || err == nil {
			t.Fatal("invalid configuration admitted a setup")
		}
		serialized := roundTripOwnerFailure(t, err, codes.InvalidArgument, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE, "INTEGRATION_CONFIGURATION_INVALID")
		fixture, readErr := os.ReadFile("../../../../kit/shell/protected-local/testdata/integration-invalid-configuration-status.b64")
		if readErr != nil {
			t.Fatal(readErr)
		}
		fixtureWire, decodeErr := base64.StdEncoding.DecodeString(strings.TrimSpace(string(fixture)))
		if decodeErr != nil {
			t.Fatal(decodeErr)
		}
		var expected statuspb.Status
		if decodeErr := proto.Unmarshal(fixtureWire, &expected); decodeErr != nil {
			t.Fatal(decodeErr)
		}
		// This is the actual Go owner status consumed by the native carrier test.
		// Compare decoded ErrorInfo because protobuf map wire ordering is free.
		actualStatus := status.FromProto(serialized)
		expectedStatus := status.FromProto(&expected)
		if actualStatus.Code() != expectedStatus.Code() || actualStatus.Message() != expectedStatus.Message() ||
			len(actualStatus.Details()) != 1 || len(expectedStatus.Details()) != 1 ||
			!proto.Equal(actualStatus.Details()[0].(proto.Message), expectedStatus.Details()[0].(proto.Message)) {
			t.Fatal("Go owner status disagrees with the native carrier fixture")
		}
	}
	if len(s.setups) != 0 || len(s.secrets.(*testSecrets).values) != 0 {
		t.Fatal("invalid configuration created setup or credential state")
	}
}

func TestIntegrationOwnerRefusalsKeepRPCCodeAfterSerialization(t *testing.T) {
	for _, row := range []struct {
		code              codes.Code
		integrationReason string
	}{
		{codes.InvalidArgument, "INTEGRATION_INPUT_INVALID"},
		{codes.NotFound, "INTEGRATION_TARGET_NOT_FOUND"},
		{codes.PermissionDenied, "INTEGRATION_PERMISSION_REQUIRED"},
		{codes.ResourceExhausted, "INTEGRATION_SETUP_LIMIT"},
		{codes.Canceled, "INTEGRATION_SETUP_STOPPED"},
		{codes.FailedPrecondition, "INTEGRATION_CONFIGURATION_CHANGED"},
		{codes.AlreadyExists, "INTEGRATION_IDENTITY_ALREADY_CONNECTED"},
	} {
		t.Run(row.code.String(), func(t *testing.T) {
			roundTripOwnerFailure(t, failure(row.code, row.integrationReason), row.code, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE, row.integrationReason)
		})
	}
	for _, code := range []codes.Code{codes.Unavailable, codes.DeadlineExceeded} {
		roundTripOwnerFailure(t, failure(code, "INTEGRATION_DISCOVERY_FAILED"), code, runtimev1.ReasonCode_LOCAL_APP_OWNER_UNAVAILABLE, "INTEGRATION_DISCOVERY_FAILED")
	}
	// An unknown service failure must not be relabeled as a known owner refusal.
	if _, typed := grpcerr.ExtractReasonCode(failure(codes.Internal, "INTEGRATION_UNCLASSIFIED")); typed {
		t.Fatal("unclassified service failure was given an owner refusal reason")
	}
}
