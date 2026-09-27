package connector

import (
	"errors"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

func TestAIConfigEffectiveFailureState(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want runtimev1.AIConfigEffectiveState
	}{
		{
			name: "connector missing",
			err:  grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_CONNECTOR_NOT_FOUND),
			want: runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_MISSING,
		},
		{
			name: "credential blocked",
			err:  grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONNECTOR_CREDENTIAL_MISSING),
			want: runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_BLOCKED,
		},
		{
			name: "provider internal",
			err:  grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL),
			want: runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_UNAVAILABLE,
		},
		{
			name: "provider unavailable",
			err:  grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE),
			want: runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_UNAVAILABLE,
		},
		{
			name: "untyped dependency failure",
			err:  errors.New("dependency failure"),
			want: runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_UNAVAILABLE,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := AIConfigEffectiveFailureState(test.err); got != test.want {
				t.Fatalf("state = %s, want %s", got, test.want)
			}
		})
	}
}

func TestAIConfigCloudTargetOptionsCanonicalizeExecutableAliases(t *testing.T) {
	svc := newTestService(t)
	created, err := svc.CreateConnector(userContext("user-1"), &runtimev1.CreateConnectorRequest{
		Provider: "dashscope", ApiKey: "managed-key",
	})
	if err != nil {
		t.Fatal(err)
	}
	connectorID := created.GetConnector().GetConnectorId()
	catalog := svc.modelCatalogResolver()
	options, truncated, err := ListAIConfigCloudTargetOptions(svc.Store(), catalog, "user-1", "audio.transcribe", connectorID, "", 200)
	if err != nil || truncated || len(options) == 0 {
		t.Fatalf("options=%d truncated=%v err=%v", len(options), truncated, err)
	}
	seen := make(map[string]AIConfigCloudTargetOption)
	for _, option := range options {
		fields := option.ProviderTarget.AsMap()
		id := fields["remoteModelCatalogId"].(string)
		if previous, found := seen[id]; found {
			t.Fatalf("same executable target appears twice: %q and %q", previous.Label, option.Label)
		}
		seen[id] = option
		_, _, err := ValidateAIConfigCloudSelection(svc.Store(), catalog, "user-1", "audio.transcribe", option.Implementation, RemoteModelCatalogRef{
			ConnectorID: connectorID, RemoteModelCatalogID: id,
			Provider: "dashscope", ProviderModelID: fields["providerModelId"].(string),
		})
		if err != nil {
			t.Fatalf("listed target %q cannot be selected: %v", option.Label, err)
		}
	}
	// Searching a dated catalog alias must retain the same exact target and
	// canonical display label, rather than making the alias a second resource.
	filtered, truncated, err := ListAIConfigCloudTargetOptions(svc.Store(), catalog, "user-1", "audio.transcribe", connectorID, "2025-09-08", 1)
	if err != nil || truncated || len(filtered) != 1 {
		t.Fatalf("alias search: options=%d truncated=%v err=%v", len(filtered), truncated, err)
	}
	got := filtered[0]
	id := got.ProviderTarget.AsMap()["remoteModelCatalogId"].(string)
	if canonical, ok := seen[id]; !ok || got.Label != canonical.Label {
		t.Fatalf("alias search changed the target presentation: got=%q canonical=%q", got.Label, canonical.Label)
	}
}
