package capabilitydriver

import (
	"encoding/json"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func segmentationFactsForTest() onnxModel {
	return onnxModel{IRVersion: 8, Inputs: []onnxTensor{{Type: 1, Shape: []int64{-1, 1, -1}}}, Outputs: []onnxTensor{{Type: 1, Shape: []int64{-1, -1, 7}}}, Opsets: map[string]uint64{"": 17}, Metadata: map[string]string{"model_type": "pyannote-segmentation-3.0", "version": "1", "sample_rate": "16000", "num_speakers": "3", "num_classes": "7", "powerset_max_classes": "2", "window_size": "160000", "receptive_field_size": "991", "receptive_field_shift": "270"}}
}
func TestDiarizedWhisperRequiresFourActualModelContractsAndCapturedProfile(t *testing.T) {
	driver := FasterWhisperSherpaDriver{}
	requirements, reason := driver.ProjectRecipe(FasterWhisperSherpaRecipeID, nil, nil)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED || len(requirements) != 4 {
		t.Fatalf("diarized slots: %+v %s", requirements, reason)
	}
	model := segmentationFactsForTest()
	raw, _ := json.Marshal(model)
	if !speakerSegmentationFacts(raw) {
		t.Fatal("actual segmentation geometry rejected")
	}
	model.Metadata["num_classes"] = "8"
	raw, _ = json.Marshal(model)
	if speakerSegmentationFacts(raw) {
		t.Fatal("contradictory powerset geometry accepted")
	}
	root := t.TempDir()
	hash := strings.Repeat("a", 64)
	input := SpeechTranscribeInvocationInput{Request: &runtimev1.SpeechTranscribeScenarioSpec{Diarization: testBool(true), Prompt: "原始词典"}, AudioBytes: []byte("declared audio fixture"), MIMEType: "audio/wav"}
	for _, requirement := range requirements {
		input.ExactBindings = append(input.ExactBindings, InvocationExactBinding{RequirementID: requirement.RequirementId, ModelAssetID: requirement.RequirementId, AbsolutePath: filepath.Join(root, requirement.RequirementId), VerifiedContentID: "sha256:" + hash, EntrySHA256: hash})
	}
	if _, err := driver.PlanSpeechTranscribeInvocation(input); err == nil {
		t.Fatal("profile-less inference accepted")
	}
	input.DependencySources = []InvocationExactDependencySource{{DependencyFamily: "python.package-set", ConsumerScope: WhisperDiarizationConsumerID, SelectedSourceRecordID: "declared-profile-record", CanonicalRoot: root, Version: hash, Hashes: map[string]string{"profile_digest": hash, "driver_bundle_sha256": hash}}}
	plan, err := driver.PlanSpeechTranscribeInvocation(input)
	if err != nil {
		t.Fatal(err)
	}
	input.Request.Prompt = "replaced"
	input.DependencySources[0].Hashes["profile_digest"] = "replaced"
	if plan.Request().Prompt != "原始词典" || plan.DependencySources()[0].Hashes["profile_digest"] != hash || len(plan.ModelFiles()) != 4 {
		t.Fatal("captured model/request/dependency inputs were mutable")
	}
}
func TestActualRenamedSegmentationModelProbe(t *testing.T) {
	path := os.Getenv("NIMI_TEST_SEGMENTATION_ONNX_PATH")
	if path == "" {
		t.Skip("actual segmentation model not supplied")
	}
	file, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		t.Fatal(err)
	}
	probe, err := (FasterWhisperSherpaDriver{}).ProbeModelAsset(ModelAssetFormatProbeInput{RequirementID: SpeechSegmenterSlot, Entry: true}, file, info.Size())
	if err != nil {
		t.Fatal(err)
	}
	if !speakerSegmentationFacts(probe) {
		var facts onnxModel
		_ = json.Unmarshal(probe, &facts)
		t.Logf("actual bounded segmentation facts: %+v", facts)
		t.Fatal("actual captured segmentation graph/metadata rejected")
	}
}
