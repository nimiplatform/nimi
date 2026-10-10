package capabilitydriver

import (
	"encoding/binary"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestWhisperCapturesBoundedOriginalVocabularyContext(t *testing.T) {
	digest := strings.Repeat("a", 64)
	root := t.TempDir()
	bindings := []InvocationExactBinding{}
	for _, slot := range []string{Qwen3ASRModelRequirementID, FasterWhisperVADRequirementID} {
		bindings = append(bindings, InvocationExactBinding{RequirementID: slot, ModelAssetID: "fixture-" + slot, AbsolutePath: filepath.Join(root, slot), VerifiedContentID: "sha256:" + digest, EntrySHA256: digest})
	}
	request := &runtimev1.SpeechTranscribeScenarioSpec{Prompt: "  Nimi，专有名词\n", Timestamps: testBool(true)}
	input := SpeechTranscribeInvocationInput{ExactBindings: bindings, Request: request, AudioBytes: []byte("declared recording fixture"), MIMEType: "audio/wav"}
	plan, err := (FasterWhisperDriver{}).PlanSpeechTranscribeInvocation(input)
	if err != nil {
		t.Fatal(err)
	}
	request.Prompt = "changed after admission"
	if plan.Request().GetPrompt() != "  Nimi，专有名词\n" {
		t.Fatal("captured vocabulary context changed or was trimmed")
	}
	for _, prompt := range []string{"", strings.Repeat("中", 1365) + "a"} {
		request.Prompt = prompt
		if _, err := (FasterWhisperDriver{}).PlanSpeechTranscribeInvocation(input); err != nil {
			t.Fatalf("valid UTF-8 context rejected: %v", err)
		}
	}
	for _, prompt := range []string{strings.Repeat("中", 1366), string([]byte{0xff})} {
		request.Prompt = prompt
		if _, err := (FasterWhisperDriver{}).PlanSpeechTranscribeInvocation(input); err == nil {
			t.Fatal("invalid or over-budget vocabulary context accepted")
		}
	}
	request.Prompt = "valid context"
	request.Diarization = testBool(true)
	if _, err := (FasterWhisperDriver{}).PlanSpeechTranscribeInvocation(input); err == nil {
		t.Fatal("plain Whisper path accepted diarization")
	}
}

func TestFasterWhisperRequiresBothDistinctModelRoles(t *testing.T) {
	driver := FasterWhisperDriver{}
	requirements, reason := driver.ProjectRecipe(FasterWhisperRecipeID, nil, nil)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED || len(requirements) != 2 || requirements[0].GetRequirementId() != "stt.model" || requirements[1].GetRequirementId() != "stt.vad" {
		t.Fatalf("Whisper recipe requirements: %+v, %v", requirements, reason)
	}
	if requirements[0].GetCompatibilityConstraints().GetFields()["format"].GetStringValue() != "ctranslate2" || requirements[1].GetCompatibilityConstraints().GetFields()["format"].GetStringValue() != "onnx" {
		t.Fatal("recognition and detection lost their exact format contracts")
	}
	if _, reason := driver.ProjectRecipe(Qwen3ASRAlignedRecipeID, nil, nil); reason == runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		t.Fatal("Whisper accepted another Driver's recipe")
	}
	if _, reason := driver.Interpret(InterpretInput{SupportedFeatures: []string{"diarization"}}); reason == runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		t.Fatal("Whisper accepted unsupported diarization")
	}
}

func TestWhisperModelFormatsRejectOtherArchitectures(t *testing.T) {
	name := []byte("WhisperSpec\x00")
	header := make([]byte, 6+len(name)+8)
	binary.LittleEndian.PutUint32(header, 6)
	binary.LittleEndian.PutUint16(header[4:], uint16(len(name)))
	copy(header[6:], name)
	binary.LittleEndian.PutUint32(header[6+len(name):], 3)
	binary.LittleEndian.PutUint32(header[10+len(name):], 1)
	if !whisperCT2Header(header) {
		t.Fatal("valid CTranslate2 Whisper header rejected")
	}
	header[6] = 'X'
	if whisperCT2Header(header) {
		t.Fatal("non-Whisper CTranslate2 architecture accepted")
	}
	model := onnxModel{IRVersion: 8, Inputs: []onnxTensor{{Name: "input", Type: 1}, {Name: "state", Type: 1}, {Name: "sr", Type: 7}}, Outputs: []onnxTensor{{Name: "output", Type: 1}, {Name: "stateN", Type: 1}}}
	probe, _ := json.Marshal(model)
	if !sileroONNXInterface(probe) {
		t.Fatal("Silero ONNX interface rejected")
	}
	model.Inputs[1].Name = "unrelated_tensor"
	probe, _ = json.Marshal(model)
	if sileroONNXInterface(probe) {
		t.Fatal("unrelated ONNX graph accepted")
	}
}
