package connector

import (
	"context"
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
	options, truncated, err := ListAIConfigCloudTargetOptions(context.Background(), svc.Store(), catalog, "user-1", "audio.transcribe", connectorID, "", 200)
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
	filtered, truncated, err := ListAIConfigCloudTargetOptions(context.Background(), svc.Store(), catalog, "user-1", "audio.transcribe", connectorID, "2025-09-08", 1)
	if err != nil || truncated || len(filtered) != 1 {
		t.Fatalf("alias search: options=%d truncated=%v err=%v", len(filtered), truncated, err)
	}
	got := filtered[0]
	id := got.ProviderTarget.AsMap()["remoteModelCatalogId"].(string)
	if canonical, ok := seen[id]; !ok || got.Label != canonical.Label {
		t.Fatalf("alias search changed the target presentation: got=%q canonical=%q", got.Label, canonical.Label)
	}
}

func TestAIConfigCloudEmbeddingRequiresVerifiedFixedDimension(t *testing.T) {
	svc := newTestService(t)
	catalog := svc.modelCatalogResolver()
	for _, tc := range []struct {
		provider string
		model    string
		ready    bool
	}{
		{provider: "volcengine", model: "doubao-embedding"},
		{provider: "gemini", model: "gemini-embedding-2-preview"},
		{provider: "gemini", model: "gemini-embedding-2", ready: true},
		{provider: "gemini", model: "gemini-embedding-001", ready: true},
	} {
		t.Run(tc.provider+"/"+tc.model, func(t *testing.T) {
			created, err := svc.CreateConnector(userContext("user-1"), &runtimev1.CreateConnectorRequest{
				Provider: tc.provider, ApiKey: "managed-key",
			})
			if err != nil {
				t.Fatal(err)
			}
			connectorID := created.GetConnector().GetConnectorId()
			options, _, err := ListAIConfigCloudTargetOptions(context.Background(), svc.Store(), catalog, "user-1", "text.embed", connectorID, tc.model, 200)
			if err != nil {
				t.Fatal(err)
			}
			var option *AIConfigCloudTargetOption
			for i := range options {
				if options[i].Label == tc.model {
					option = &options[i]
					break
				}
			}
			if option == nil {
				t.Fatalf("model %q missing from target options", tc.model)
			}
			fields := option.ProviderTarget.AsMap()
			_, _, err = ValidateAIConfigCloudSelection(svc.Store(), catalog, "user-1", "text.embed", option.Implementation, RemoteModelCatalogRef{
				ConnectorID: connectorID, RemoteModelCatalogID: fields["remoteModelCatalogId"].(string),
				Provider: tc.provider, ProviderModelID: fields["providerModelId"].(string),
			})
			if tc.ready {
				if option.State != runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_READY || err != nil {
					t.Fatalf("fixed-width target rejected: state=%s err=%v", option.State, err)
				}
				return
			}
			if option.State != runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_BLOCKED ||
				len(option.Reasons) != 1 || option.Reasons[0] != runtimev1.ReasonCode_CAPABILITY_CATALOG_MISMATCH {
				t.Fatalf("unverified-width target offered as executable: %+v", option)
			}
			if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_CAPABILITY_CATALOG_MISMATCH {
				t.Fatalf("unverified-width target validation reason=%v present=%v err=%v", reason, ok, err)
			}
		})
	}
}

func TestRealtimeCloudImplementationKeepsProviderDialectsSeparate(t *testing.T) {
	for _, provider := range []string{"openai", "dashscope"} {
		identity, ok := aiConfigCloudImplementation(provider, "realtime.interact")
		if !ok || identity.GetImplementationId() != "cloud.realtime.interact."+provider || identity.GetDriverDialect() != provider+"/realtime/v1" {
			t.Fatalf("%s: %+v %v", provider, identity, ok)
		}
	}
	if _, ok := aiConfigCloudImplementation("openai_chatgpt_plan", "realtime.interact"); ok {
		t.Fatal("ChatGPT plan was treated as standard OpenAI Realtime")
	}
}
