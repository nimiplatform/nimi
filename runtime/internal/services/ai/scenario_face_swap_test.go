package ai

import (
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/protobuf/encoding/protowire"
)

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

func TestImageFaceSwapJobBudgetDoesNotInheritGenerationDefaults(t *testing.T) {
	for _, test := range []struct {
		input int32
		want  time.Duration
	}{{0, 120 * time.Second}, {1000, time.Second}, {600000, 10 * time.Minute}} {
		got, err := imageFaceSwapJobTimeout(test.input)
		if err != nil || got != test.want {
			t.Fatalf("timeout %d: %s, %v", test.input, got, err)
		}
	}
	for _, value := range []int32{-1, 999, 600001} {
		_, err := imageFaceSwapJobTimeout(value)
		if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
			t.Fatalf("invalid timeout %d: %v", value, err)
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

func TestVideoFaceSwapRequiresPolicyAndIndependentDeadline(t *testing.T) {
	spec := &runtimev1.VideoFaceSwapScenarioSpec{ReferenceImageArtifactId: "reference", TargetVideoArtifactId: "video", NoFacePolicy: runtimev1.FaceSwapNoFacePolicy_FACE_SWAP_NO_FACE_POLICY_PRESERVE_FRAME}
	if err := validateVideoFaceSwapSpec(spec); err != nil {
		t.Fatal(err)
	}
	spec.NoFacePolicy = runtimev1.FaceSwapNoFacePolicy_FACE_SWAP_NO_FACE_POLICY_UNSPECIFIED
	if err := validateVideoFaceSwapSpec(spec); err == nil {
		t.Fatal("missing no-face policy was accepted")
	}
	for _, value := range []int32{-1, 999, 3600001} {
		if _, err := videoFaceSwapJobTimeout(value); err == nil {
			t.Fatalf("invalid video deadline %d", value)
		}
	}
	if duration, err := videoFaceSwapJobTimeout(0); err != nil || duration != 900*time.Second {
		t.Fatalf("video default deadline: %s %v", duration, err)
	}
	for _, mode := range []runtimev1.ExecutionMode{runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, runtimev1.ExecutionMode_EXECUTION_MODE_STREAM} {
		if err := validateScenarioExecutionMode(runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_FACE_SWAP, mode); err == nil {
			t.Fatal("video face replacement accepted a synchronous or streaming Job alias")
		}
	}
}
