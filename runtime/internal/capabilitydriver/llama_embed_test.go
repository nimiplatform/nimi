package capabilitydriver

import (
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestLlamaEmbedDriverProjectsExactEmbeddingSlotAndPlan(t *testing.T) {
	driver := LlamaEmbedDriver{}
	requirements, reason := driver.Interpret(InterpretInput{})
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED || len(requirements) != 1 {
		t.Fatalf("Interpret = requirements=%+v reason=%v", requirements, reason)
	}
	requirement := requirements[0]
	if requirement.GetRequirementId() != EmbeddingGGUFRequirementID ||
		requirement.GetCompatibilityConstraints().GetFields()["artifact_role"].GetStringValue() != "embedding" {
		t.Fatalf("embedding requirement = %+v", requirement)
	}
	digest := strings.Repeat("a", 64)
	binding := &runtimev1.ModelAssetExactBinding{
		RequirementId:     EmbeddingGGUFRequirementID,
		ModelAssetId:      "embedding/test",
		VerifiedContentId: "sha256:" + digest,
		EntrySha256:       digest,
	}
	asset := ModelAssetDescriptor{
		ModelAssetID:      "embedding/test",
		VerifiedContentID: "sha256:" + digest,
		EntrySHA256:       digest,
		Kind:              runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_EMBEDDING,
		Engine:            "llama",
		ArtifactRoles:     []string{"embedding"},
	}
	if reason := driver.ValidateCombination(requirements, []*runtimev1.ModelAssetExactBinding{binding}, []ModelAssetDescriptor{asset}); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		t.Fatalf("ValidateCombination reason = %v", reason)
	}
	plan, err := driver.PlanEmbedInvocation(EmbedInvocationInput{
		ModelContextWindowTokens: 8192,
		ExactBindings: []InvocationExactBinding{{
			RequirementID:     EmbeddingGGUFRequirementID,
			ModelAssetID:      "embedding/test",
			AbsolutePath:      filepath.Join(t.TempDir(), "embedding.gguf"),
			VerifiedContentID: "sha256:" + digest,
			EntrySHA256:       digest,
		}},
		Request: &runtimev1.TextEmbedScenarioSpec{Inputs: []string{" first ", "second"}},
	})
	if err != nil {
		t.Fatalf("PlanEmbedInvocation: %v", err)
	}
	if plan.ProcessKey() == "" || plan.RequestPath() != "/v1/embeddings" || plan.ExpectedCount() != 2 {
		t.Fatalf("embedding plan = key=%q path=%q count=%d", plan.ProcessKey(), plan.RequestPath(), plan.ExpectedCount())
	}
	if !contains(plan.ProcessArgs(), "--embedding") {
		t.Fatalf("embedding process args = %v", plan.ProcessArgs())
	}
	if !containsAdjacent(plan.ProcessArgs(), "--ubatch-size", "8192") {
		t.Fatalf("embedding process physical batch does not cover the admitted context window: %v", plan.ProcessArgs())
	}
	var request map[string]any
	if err := json.Unmarshal(plan.RequestBody(), &request); err != nil {
		t.Fatalf("decode request: %v", err)
	}
	inputs, ok := request["input"].([]any)
	if !ok || len(inputs) != 2 || inputs[0] != "first" || inputs[1] != "second" || request["encoding_format"] != "float" {
		t.Fatalf("embedding request = %#v", request)
	}
}

func containsAdjacent(values []string, key string, value string) bool {
	for index := 0; index+1 < len(values); index++ {
		if values[index] == key && values[index+1] == value {
			return true
		}
	}
	return false
}

func TestProductionRegistryResolvesOnlyExactLlamaEmbedIdentity(t *testing.T) {
	identity := Identity{
		ImplementationID: LlamaEmbedImplementationID,
		DriverID:         LlamaDriverID,
		DriverDialect:    LlamaEmbedDriverDialect,
	}
	driver, reason := NewProductionRegistry().Resolve(TextEmbedCapabilityContract, identity)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED || driver == nil {
		t.Fatalf("Resolve(text.embed) = driver=%T reason=%v", driver, reason)
	}
	if _, ok := driver.(EmbedInvocationDriver); !ok {
		t.Fatalf("resolved driver %T is not EmbedInvocationDriver", driver)
	}
	wrong := identity
	wrong.DriverDialect = LlamaDriverDialect
	if _, reason := NewProductionRegistry().Resolve(TextEmbedCapabilityContract, wrong); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_DIALECT_UNSUPPORTED {
		t.Fatalf("wrong dialect reason = %v", reason)
	}
}
