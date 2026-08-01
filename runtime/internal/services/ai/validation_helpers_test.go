package ai

import (
	"context"
	"io"
	"log/slog"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
)

func TestValidateBaseRequestAndPrompt(t *testing.T) {
	tests := []struct {
		name     string
		appID    string
		userID   string
		modelID  string
		route    runtimev1.RoutePolicy
		prompt   string
		reason   runtimev1.ReasonCode
		expectOK bool
	}{
		{name: "valid", appID: "a", userID: "u", modelID: "local/qwen", route: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL, prompt: "hello", expectOK: true},
		{name: "missing app", appID: "", userID: "u", modelID: "m", route: runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD, prompt: "x", reason: runtimev1.ReasonCode_AI_APP_ID_REQUIRED},
		{name: "missing envelope", appID: "a", userID: "", modelID: "m", route: runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD, prompt: "x", reason: runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID},
		{name: "missing route", appID: "a", userID: "u", modelID: "m", route: runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED, prompt: "x", reason: runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID},
		{name: "multimodel unsupported", appID: "a", userID: "u", modelID: "a,b", route: runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD, prompt: "x", reason: runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED},
		{name: "empty prompt", appID: "a", userID: "u", modelID: "m", route: runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD, prompt: "", reason: runtimev1.ReasonCode_AI_INPUT_INVALID},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validatePromptRequest(tt.appID, tt.userID, tt.modelID, tt.prompt, tt.route)
			if tt.expectOK {
				if err != nil {
					t.Fatalf("expected no error, got %v", err)
				}
				return
			}
			if err == nil {
				t.Fatalf("expected error")
			}
			reason, ok := grpcerr.ExtractReasonCode(err)
			if !ok || reason != tt.reason {
				t.Fatalf("reason mismatch: got=%v ok=%v want=%v", reason, ok, tt.reason)
			}
		})
	}
}

func TestTextHelpersAndTokenEstimation(t *testing.T) {
	text := composeInputText("  system  ", []*runtimev1.ChatMessage{
		{Role: "user", Content: "  alpha  "},
		{Role: "assistant", Content: ""},
		{Role: "user", Content: "beta"},
	})
	if text != "system\nalpha\nbeta" {
		t.Fatalf("unexpected composed text: %q", text)
	}

	parts := nimillm.SplitText("你好world", 2)
	if len(parts) != 4 {
		t.Fatalf("unexpected chunk count: %d", len(parts))
	}
	if split := nimillm.SplitText("", 0); len(split) != 0 {
		t.Fatalf("unexpected empty split result: %#v", split)
	}

	if got := estimateTokens("abcd"); got != 1 {
		t.Fatalf("expected 1 token, got %d", got)
	}
	if got := estimateTokens("abcde"); got != 2 {
		t.Fatalf("expected 2 tokens, got %d", got)
	}
	usage := estimateUsage("input", "output text")
	if usage.GetInputTokens() == 0 || usage.GetOutputTokens() == 0 {
		t.Fatalf("usage tokens should be non-zero: %#v", usage)
	}
	if usage.GetComputeMs() < 5 {
		t.Fatalf("compute ms should be clamped, got=%d", usage.GetComputeMs())
	}
}

func TestComposeInputTextWithParts(t *testing.T) {
	t.Run("parts take priority over content", func(t *testing.T) {
		input := []*runtimev1.ChatMessage{
			{
				Role:    "user",
				Content: "should be ignored",
				Parts: []*runtimev1.ChatContentPart{
					textPart("from parts"),
				},
			},
		}
		got := composeInputText("sys", input)
		if got != "sys\nfrom parts" {
			t.Fatalf("unexpected result: %q", got)
		}
	})

	t.Run("image url parts are skipped text extracted", func(t *testing.T) {
		input := []*runtimev1.ChatMessage{
			{
				Role: "user",
				Parts: []*runtimev1.ChatContentPart{
					textPart("describe this"),
					imagePart("https://example.com/img.png"),
					textPart("in detail"),
				},
			},
		}
		got := composeInputText("", input)
		if got != "describe this\nin detail" {
			t.Fatalf("unexpected result: %q", got)
		}
	})

	t.Run("messages without parts use content fallback", func(t *testing.T) {
		input := []*runtimev1.ChatMessage{
			{Role: "user", Content: "fallback content"},
		}
		got := composeInputText("", input)
		if got != "fallback content" {
			t.Fatalf("unexpected result: %q", got)
		}
	})

	t.Run("mixed messages parts and content", func(t *testing.T) {
		input := []*runtimev1.ChatMessage{
			{
				Role: "user",
				Parts: []*runtimev1.ChatContentPart{
					textPart("part text"),
				},
			},
			{Role: "assistant", Content: "reply"},
		}
		got := composeInputText("prompt", input)
		if got != "prompt\npart text\nreply" {
			t.Fatalf("unexpected result: %q", got)
		}
	})

	t.Run("whitespace-only parts are skipped", func(t *testing.T) {
		input := []*runtimev1.ChatMessage{
			{
				Role: "user",
				Parts: []*runtimev1.ChatContentPart{
					textPart("  "),
					textPart("actual text"),
				},
			},
		}
		got := composeInputText("", input)
		if got != "actual text" {
			t.Fatalf("unexpected result: %q", got)
		}
	})
}

func TestSimplePredicates(t *testing.T) {
	if !isMultiModel("a->b") || !isMultiModel("a|b") || !isMultiModel("a,b") {
		t.Fatalf("isMultiModel should detect separators")
	}
	if isMultiModel("single-model") {
		t.Fatalf("single model should not be considered multimodel")
	}
	if got := maxInt64(3, 5); got != 5 {
		t.Fatalf("max mismatch: %d", got)
	}
}

func TestRecordRouteAutoSwitch_NoPanicOnMissingDependencies(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	// Hint disabled path.
	svc.recordRouteAutoSwitch("app", "user", "req", "res", nimillm.RouteDecisionInfo{HintAutoSwitch: false})
	// Hint enabled path with nil audit/registry should still be safe.
	svc.recordRouteAutoSwitch("app", "user", "req", "res", nimillm.RouteDecisionInfo{
		HintAutoSwitch: true,
		BackendName:    "cloud-openai",
		HintFrom:       "a",
		HintTo:         "b",
	})
}

func TestPrepareScenarioRequestAllowsAnonymousLocal(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	svc.localModel = &fakeLocalModelLister{
		responses: []*runtimev1.ListLocalAssetsResponse{{
			Assets: []*runtimev1.LocalAssetRecord{{
				LocalAssetId: "lm-1",
				AssetId:      "qwen",
				Engine:       "llama",
				Status:       runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
			}},
		}},
	}

	remoteTarget, err := svc.prepareScenarioRequest(context.Background(), &runtimev1.ScenarioRequestHead{
		AppId:       "nimi.desktop",
		ModelId:     "local/qwen",
		RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		TargetRef: setExactLocalScenarioTargetForTest(t, svc, "local/qwen", "text.generate", &runtimev1.LocalAssetRecord{
			LocalAssetId:        "lm-1",
			AssetId:             "qwen",
			LogicalModelId:      "local/qwen",
			Engine:              "llama",
			Status:              runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
			DurableTargetStatus: runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
			Capabilities:        []string{"text.generate"},
		}),
	}, runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE)
	if err != nil {
		t.Fatalf("expected anonymous local request to succeed, got %v", err)
	}
	if remoteTarget != nil {
		t.Fatalf("expected local request to keep remote target nil, got %#v", remoteTarget)
	}
}

func TestPrepareScenarioRequestRequiresRuntimeTargetRef(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))

	_, err := svc.prepareScenarioRequest(context.Background(), &runtimev1.ScenarioRequestHead{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "local/qwen",
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
	}, runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE)
	if err == nil {
		t.Fatalf("expected missing runtime target_ref to fail closed")
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID {
		t.Fatalf("unexpected reason mismatch: got=%v ok=%v want=%v", reason, ok, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
}

func TestNormalizeScenarioRuntimeTargetRefRejectsNoncanonicalDurableIdentity(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		targetRef *runtimev1.RuntimeDurableTargetRef
	}{
		{
			name: "padded local identity",
			targetRef: &runtimev1.RuntimeDurableTargetRef{Target: &runtimev1.RuntimeDurableTargetRef_LocalRuntime{LocalRuntime: &runtimev1.RuntimeDurableLocalTargetRef{
				Version: "v2",
				Ref:     &runtimev1.RuntimeDurableLocalTargetRef_ProfileBindingId{ProfileBindingId: " profile-binding-1"},
			}}},
		},
		{
			name: "padded cloud identity",
			targetRef: &runtimev1.RuntimeDurableTargetRef{Target: &runtimev1.RuntimeDurableTargetRef_Cloud{Cloud: &runtimev1.RuntimeDurableCloudTargetRef{
				Version:              "v2",
				ConnectorId:          " connector-1",
				RemoteModelCatalogId: "remote-catalog-1",
				ProviderModelId:      "provider-model-1",
				Provider:             "provider-1",
			}}},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
			_, _, _, err := svc.normalizeScenarioRuntimeTargetRef(context.Background(), &runtimev1.ScenarioRequestHead{
				AppId:         "nimi.desktop",
				SubjectUserId: "user-1",
				TargetRef:     tc.targetRef,
			}, "text.generate")
			if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID {
				t.Fatalf("reason = %s, %v; want PROTOCOL_ENVELOPE_INVALID: %v", reason, ok, err)
			}
		})
	}
}

type exactTargetLocalModelLister struct {
	*fakeLocalModelLister
	binding      *runtimev1.RuntimeResolvedLocalExecutionBinding
	asset        *runtimev1.LocalAssetRecord
	resolveCalls int
}

func (f *exactTargetLocalModelLister) ResolveDurableLocalTarget(
	_ context.Context,
	_ *runtimev1.RuntimeDurableLocalTargetRef,
	_ string,
) (*runtimev1.RuntimeResolvedLocalExecutionBinding, *runtimev1.LocalAssetRecord, error) {
	f.resolveCalls++
	return f.binding, f.asset, nil
}

func TestDurableTargetSelectsExactAssetAndRejectsConflictingModelID(t *testing.T) {
	t.Parallel()
	base := &fakeLocalModelLister{
		managedNames: map[string]string{"local-target-a": "llama-runtime-target-a"},
	}
	resolver := &exactTargetLocalModelLister{
		fakeLocalModelLister: base,
		binding: &runtimev1.RuntimeResolvedLocalExecutionBinding{
			ReadinessRef:    "local_asset_readiness:v2:opaque",
			LocalAssetId:    "local-target-a",
			ResolvedModelId: "logical/target-a",
		},
		asset: &runtimev1.LocalAssetRecord{
			LocalAssetId:        "local-target-a",
			AssetId:             "catalog/target-a",
			LogicalModelId:      "logical/target-a",
			Kind:                runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT,
			Engine:              "llama",
			Status:              runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
			DurableTargetStatus: runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
			Capabilities:        []string{"text.generate"},
		},
	}
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	svc.SetLocalModelLister(resolver)
	targetRef := &runtimev1.RuntimeDurableTargetRef{
		Target: &runtimev1.RuntimeDurableTargetRef_LocalRuntime{
			LocalRuntime: &runtimev1.RuntimeDurableLocalTargetRef{
				Version: "v2",
				Ref: &runtimev1.RuntimeDurableLocalTargetRef_ReadinessRef{
					ReadinessRef: "local_asset_readiness:v2:opaque",
				},
			},
		},
	}

	_, _, _, err := svc.normalizeScenarioRuntimeTargetRef(context.Background(), &runtimev1.ScenarioRequestHead{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-1",
		ModelId:       "logical/other",
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		TargetRef:     targetRef,
	}, "text.generate")
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AGENT_AI_CONFIG_MODEL_TARGET_MISMATCH {
		t.Fatalf("conflicting model reason = %s, %v; want AGENT_AI_CONFIG_MODEL_TARGET_MISMATCH: %v", reason, ok, err)
	}

	plan, err := svc.prepareDurableLocalModelExecutionPlan(
		context.Background(),
		"logical/target-a",
		resolver.binding,
		resolver.asset,
		runtimev1.Modal_MODAL_TEXT,
		nil,
	)
	if err != nil {
		t.Fatalf("prepare exact target plan: %v", err)
	}
	if plan.selectedLocalAssetID() != "local-target-a" || plan.providerModelID != "llama-runtime-target-a" {
		t.Fatalf("exact target plan selected wrong asset: %+v", plan)
	}
	if base.calls != 0 {
		t.Fatalf("exact target plan performed model inventory search: calls=%d", base.calls)
	}
	if resolver.resolveCalls != 1 {
		t.Fatalf("durable target resolver calls = %d, want 1", resolver.resolveCalls)
	}
}

func TestPrepareScenarioRequestRequiresSubjectForTokenAPI(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))

	_, err := svc.prepareScenarioRequest(context.Background(), &runtimev1.ScenarioRequestHead{
		AppId:       "nimi.desktop",
		ModelId:     "openai/gpt-4o-mini",
		RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
		TargetRef: &runtimev1.RuntimeDurableTargetRef{
			Target: &runtimev1.RuntimeDurableTargetRef_Cloud{
				Cloud: &runtimev1.RuntimeDurableCloudTargetRef{
					Version:              "v2",
					ConnectorId:          "conn-openai",
					RemoteModelCatalogId: "remote-catalog:conn-openai:gpt-4o-mini",
					ProviderModelId:      "gpt-4o-mini",
					Provider:             "openai",
				},
			},
		},
	}, runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE)
	if err == nil {
		t.Fatalf("expected cloud request without subject user id to fail")
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID {
		t.Fatalf("unexpected reason mismatch: got=%v ok=%v want=%v", reason, ok, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
}

func TestRequireSubjectUserIDForScenario(t *testing.T) {
	tests := []struct {
		name        string
		route       runtimev1.RoutePolicy
		parsed      ParsedKeySource
		remote      *nimillm.RemoteTarget
		wantRequire bool
	}{
		{
			name:        "anonymous local runtime",
			route:       runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			parsed:      ParsedKeySource{},
			wantRequire: false,
		},
		{
			name:        "managed key source without resolved remote target",
			route:       runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			parsed:      ParsedKeySource{KeySource: keySourceManaged, ConnectorID: "conn-1"},
			wantRequire: false,
		},
		{
			name:        "resolved managed remote connector",
			route:       runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			parsed:      ParsedKeySource{KeySource: keySourceManaged, ConnectorID: "conn-1"},
			remote:      &nimillm.RemoteTarget{ProviderType: "openai"},
			wantRequire: true,
		},
		{
			name:        "inline remote target",
			route:       runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			parsed:      ParsedKeySource{KeySource: keySourceInline, ProviderType: "openai", Endpoint: "https://example.com/v1", APIKey: "sk-test"},
			wantRequire: true,
		},
		{
			name:        "token api route",
			route:       runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
			parsed:      ParsedKeySource{},
			wantRequire: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := requireSubjectUserIDForScenario(tt.route, tt.parsed, tt.remote)
			if got != tt.wantRequire {
				t.Fatalf("requireSubjectUserIDForScenario() = %v, want %v", got, tt.wantRequire)
			}
		})
	}
}
