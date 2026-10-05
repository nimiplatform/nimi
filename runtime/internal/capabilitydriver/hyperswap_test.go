package capabilitydriver

import (
	"encoding/json"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"os"
	"path/filepath"
	"testing"
)

func hyperSwapTestGraph() onnxModel {
	return onnxModel{IRVersion: 8, Opsets: map[string]uint64{"": 15}, Inputs: []onnxTensor{{Name: "source", Type: 1, Shape: []int64{1, 512}}, {Name: "target", Type: 1, Shape: []int64{1, 3, 256, 256}}}, Outputs: []onnxTensor{{Name: "output", Type: 1, Shape: []int64{1, 3, 256, 256}}, {Name: "mask", Type: 1, Shape: []int64{1, 1, 256, 256}}}}
}

func TestHyperSwapRejectsSameWidthWrongContentAndUnreviewedGraph(t *testing.T) {
	d := HyperSwapImageDriver{}
	requirements, reason := d.ProjectRecipe(HyperSwapImageRecipeID, nil, nil)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		t.Fatal(reason)
	}
	req := requirements[2]
	data, _ := json.Marshal(hyperSwapTestGraph())
	b := &runtimev1.ModelAssetExactBinding{RequirementId: FaceSwapperSlot, ModelAssetId: "model", VerifiedContentId: "content", EntrySha256: HyperSwapSwapperSHA}
	a := ModelAssetDescriptor{ModelAssetID: "model", VerifiedContentID: "content", EntrySHA256: HyperSwapSwapperSHA, Kind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VISION, Family: "hyperswap-1a", ArtifactRoles: []string{FaceSwapperSlot}, FormatProbe: data}
	if d.ValidateBinding(req, b, a) != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		t.Fatal("exact metadata fixture rejected")
	}
	wrong := a
	wrong.EntrySHA256 = HyperSwapRecognizerSHA
	if d.ValidateBinding(req, b, wrong) == runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		t.Fatal("same-dimensional unrelated content admitted")
	}
	for _, mutate := range []func(*onnxModel){func(m *onnxModel) { m.IRVersion = 10 }, func(m *onnxModel) { m.Opsets[""] = 17 }, func(m *onnxModel) { m.NodeDomains = []string{"untrusted.ops"} }, func(m *onnxModel) { m.Outputs = m.Outputs[:1] }, func(m *onnxModel) { m.Inputs[1].Shape[2] = 128 }} {
		m := hyperSwapTestGraph()
		mutate(&m)
		bad := a
		bad.FormatProbe, _ = json.Marshal(m)
		if d.ValidateBinding(req, b, bad) == runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
			t.Fatal("incompatible exact graph admitted")
		}
	}
}

func TestHyperSwapCapturedPlanRequiresCompleteExactGroupAndProfile(t *testing.T) {
	root := t.TempDir()
	bindings := []InvocationExactBinding{}
	for _, slot := range []string{FaceDetectorSlot, FaceRecognizerSlot, FaceSwapperSlot} {
		bindings = append(bindings, InvocationExactBinding{RequirementID: slot, AbsolutePath: filepath.Join(root, slot), VerifiedContentID: "content-" + slot, EntrySHA256: hyperSwapDigest(slot)})
	}
	deps := []InvocationExactDependencySource{{DependencyFamily: "python.package-set", ConsumerScope: InsightFaceConsumerID, CanonicalRoot: root, SelectedSourceRecordID: "source", Version: "profile", Hashes: map[string]string{"profile_digest": "profile", "driver_bundle_sha256": "bundle"}}}
	p, e := (HyperSwapVideoDriver{}).PlanVideoFaceSwapSession("windows/amd64", HyperSwapVideoRecipeID, []byte("owned reference fixture"), bindings, deps)
	if e != nil || p.Backend != FaceSwapBackendHyperSwap {
		t.Fatal(p, e)
	}
	bindings[1].EntrySHA256 = HyperSwapSwapperSHA
	if _, e := planHyperSwapModels(bindings, deps); e == nil {
		t.Fatal("replaced paired encoder accepted")
	}
	if _, e := planHyperSwapModels(bindings, nil); e == nil {
		t.Fatal("missing profile accepted")
	}
}

func TestHyperSwapActualImportedPayloadProbe(t *testing.T) {
	root := os.Getenv("NIMI_HYPERSWAP_PAYLOAD_INPUT")
	if root == "" {
		t.Skip("explicit real payload root required; fixture tests do not establish model acceptance")
	}
	for _, item := range []struct{ name, slot string }{{"hyperswap_1a_256.onnx", FaceSwapperSlot}, {"arcface_w600k_r50.onnx", FaceRecognizerSlot}} {
		p := filepath.Join(root, item.name)
		f, e := os.Open(p)
		if e != nil {
			t.Fatal(e)
		}
		st, e := f.Stat()
		if e != nil {
			_ = f.Close()
			t.Fatal(e)
		}
		probe, e := (HyperSwapImageDriver{}).ProbeModelAsset(ModelAssetFormatProbeInput{RecipeID: HyperSwapImageRecipeID, RequirementID: item.slot, RelativePath: item.name, Entry: true}, f, st.Size())
		closeErr := f.Close()
		if e != nil || closeErr != nil {
			t.Fatal(e, closeErr)
		}
		var m onnxModel
		if json.Unmarshal(probe, &m) != nil || !hyperSwapInterface(item.slot, m) {
			t.Fatalf("actual payload interface rejected: %s", probe)
		}
	}
}
