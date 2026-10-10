package ai

import (
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"google.golang.org/protobuf/encoding/protowire"
)

func TestCapturedFaceSwapRestoresOnlyItsCompleteDriverIdentity(t *testing.T) {
	root := t.TempDir()
	bindings := []capabilitydriver.InvocationExactBinding{}
	for index, slot := range []string{capabilitydriver.FaceDetectorSlot, capabilitydriver.FaceRecognizerSlot, capabilitydriver.FaceSwapperSlot} {
		bindings = append(bindings, capabilitydriver.InvocationExactBinding{RequirementID: slot, AbsolutePath: filepath.Join(root, slot), VerifiedContentID: "content-" + slot, EntrySHA256: []string{capabilitydriver.HyperSwapDetectorSHA, capabilitydriver.HyperSwapRecognizerSHA, capabilitydriver.HyperSwapSwapperSHA}[index]})
	}
	deps := []capabilitydriver.InvocationExactDependencySource{{DependencyFamily: "python.package-set", ConsumerScope: capabilitydriver.InsightFaceConsumerID, CanonicalRoot: root, SelectedSourceRecordID: "selected", Version: "profile", Hashes: map[string]string{"profile_digest": "profile", "driver_bundle_sha256": "bundle"}}}
	for _, item := range []struct{ implementation, driver, dialect, recipe, backend string }{
		{capabilitydriver.HyperSwapVideoImplementationID, capabilitydriver.HyperSwapDriverID, capabilitydriver.HyperSwapVideoDialect, capabilitydriver.HyperSwapVideoRecipeID, capabilitydriver.FaceSwapBackendHyperSwap},
		{capabilitydriver.InsightFaceVideoImplementationID, capabilitydriver.InsightFaceDriverID, capabilitydriver.InsightFaceVideoDriverDialect, capabilitydriver.InsightFaceVideoRecipeID, capabilitydriver.FaceSwapBackendInsightFace},
	} {
		a := &localResolvedAssembly{CapabilityContract: capabilitydriver.VideoFaceSwapContract, DriverIdentity: localResolvedAssemblyDriverIdentity{ImplementationID: item.implementation, DriverID: item.driver, DriverDialect: item.dialect}}
		p, err := restoredVideoFaceSwapPlanner(a)
		if err != nil {
			t.Fatal(err)
		}
		models, err := p.PlanVideoFaceSwapSession("windows/amd64", item.recipe, []byte("owned fixture"), bindings, deps)
		if err != nil || models.Backend != item.backend {
			t.Fatalf("restored backend=%q err=%v", models.Backend, err)
		}
		for _, field := range []string{"implementation", "driver", "dialect"} {
			bad := *a
			switch field {
			case "implementation":
				bad.DriverIdentity.ImplementationID = "unregistered"
			case "driver":
				bad.DriverIdentity.DriverID = "unregistered"
			case "dialect":
				bad.DriverIdentity.DriverDialect = "unregistered"
			}
			if _, err := restoredVideoFaceSwapPlanner(&bad); err == nil {
				t.Fatalf("changed %s identity was restored", field)
			}
		}
	}
}

func TestImageFaceSwapSpecIsOwnedArtifactOnly(t *testing.T) {
	valid := &runtimev1.ImageFaceSwapScenarioSpec{ReferenceImageArtifactId: "reference-1", TargetImageArtifactId: "target-1"}
	owner, kind, err := validateLocalAppScenarioJobRequest(&runtimev1.SubmitLocalAppScenarioJobRequest{Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_ImageFaceSwap{ImageFaceSwap: valid}})
	if err != nil || kind != runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_FACE_SWAP || owner.GetImageFaceSwap().GetTargetImageArtifactId() != "target-1" {
		t.Fatalf("typed artifact input: %v", err)
	}
	valid.TargetImageArtifactId = "changed"
	if owner.GetImageFaceSwap().GetTargetImageArtifactId() != "target-1" {
		t.Fatal("caller mutation changed captured spec")
	}
	for _, invalid := range []*runtimev1.ImageFaceSwapScenarioSpec{nil, {}, {ReferenceImageArtifactId: "reference-1"}, {ReferenceImageArtifactId: "reference-1", TargetImageArtifactId: " bad "}} {
		if err := validateImageFaceSwapSpec(invalid); err == nil {
			t.Fatalf("invalid face replacement input admitted: %v", invalid)
		}
	}
	unknown := protowire.AppendTag(nil, 3, protowire.BytesType)
	unknown = protowire.AppendString(unknown, "caller-model-override")
	valid.ProtoReflect().SetUnknown(unknown)
	if err := validateImageFaceSwapSpec(valid); err == nil {
		t.Fatal("unknown face replacement field admitted")
	}
	for _, mode := range []runtimev1.ExecutionMode{runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, runtimev1.ExecutionMode_EXECUTION_MODE_STREAM} {
		if err := validateScenarioExecutionMode(kind, mode); err == nil {
			t.Fatal("face replacement admitted a non-Job mode")
		}
	}
}

func TestFaceSelectionFailuresHaveStableActionableDetails(t *testing.T) {
	for reason, want := range map[runtimev1.ReasonCode]string{
		runtimev1.ReasonCode_AI_FACE_REFERENCE_MISSING:   "no face was detected in the reference image",
		runtimev1.ReasonCode_AI_FACE_REFERENCE_AMBIGUOUS: "the reference image must contain exactly one face",
		runtimev1.ReasonCode_AI_FACE_TARGET_MISSING:      "no face was detected in the target image",
		runtimev1.ReasonCode_AI_FACE_TARGET_AMBIGUOUS:    "the target image must contain exactly one face",
	} {
		if got := sanitizeScenarioJobReasonDetail(nil, reason); got != want {
			t.Fatalf("%s: %q", reason, got)
		}
	}
}

func TestVideoFaceSwapRequiresPolicyAndJobExecutionMode(t *testing.T) {
	spec := &runtimev1.VideoFaceSwapScenarioSpec{ReferenceImageArtifactId: "reference", TargetVideoArtifactId: "video", NoFacePolicy: runtimev1.FaceSwapNoFacePolicy_FACE_SWAP_NO_FACE_POLICY_PRESERVE_FRAME}
	if err := validateVideoFaceSwapSpec(spec); err != nil {
		t.Fatal(err)
	}
	spec.NoFacePolicy = runtimev1.FaceSwapNoFacePolicy_FACE_SWAP_NO_FACE_POLICY_UNSPECIFIED
	if err := validateVideoFaceSwapSpec(spec); err == nil {
		t.Fatal("missing no-face policy was accepted")
	}
	for _, mode := range []runtimev1.ExecutionMode{runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, runtimev1.ExecutionMode_EXECUTION_MODE_STREAM} {
		if err := validateScenarioExecutionMode(runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_FACE_SWAP, mode); err == nil {
			t.Fatal("video face replacement accepted a synchronous or streaming Job alias")
		}
	}
}
