package engine

import (
	"testing"

	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

func TestSpeakerEncoderManagedProfileCapturesTorchFreeCPUComposition(t *testing.T) {
	identity, err := ResolvePythonDependencyProfileIdentity(SpeakerEncoderConsumerID, "windows/amd64", "cpu")
	if err != nil {
		t.Fatal(err)
	}
	if identity.TorchVersion != "" || identity.CUDAABI != "" || identity.DriverProtocol != capabilitydriver.SpeakerEncoderProtocol {
		t.Fatalf("speaker profile acquired another execution composition: %+v", identity)
	}
	files, err := PythonDependencyProfileStaticFiles(SpeakerEncoderConsumerID, identity)
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 4 || files[2].RelativePath != "speaker_embedding_driver.py" {
		t.Fatalf("speaker Driver bundle is incomplete: %+v", files)
	}
	probes, err := pythonDependencyProfileImportProbes(SpeakerEncoderConsumerID, identity)
	if err != nil || len(probes) != 4 {
		t.Fatalf("speaker imports: %+v, %v", probes, err)
	}
	if _, err := ResolvePythonDependencyProfileIdentity(SpeakerEncoderConsumerID, "windows/amd64", "cuda"); err == nil {
		t.Fatal("speaker CPU profile claimed CUDA")
	}
}
