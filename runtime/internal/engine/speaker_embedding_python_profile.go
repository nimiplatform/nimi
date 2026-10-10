package engine

import (
	_ "embed"
	"fmt"
	"path/filepath"

	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

// @nimi-authority: rule.nimi.runtime.speaker-representation.sherpa-speaker-encoder
const SpeakerEncoderConsumerID = capabilitydriver.SpeakerEncoderConsumerID

//go:embed assets/speaker_embedding_driver.py
var speakerEmbeddingDriverScript string

//go:embed assets/speaker_embedding_server.py
var speakerEmbeddingServerScript string

func speakerEncoderDriverStaticFiles() []PythonDependencyProfileStaticFile {
	return []PythonDependencyProfileStaticFile{{RelativePath: "speaker_embedding_driver.py", Content: []byte(speakerEmbeddingDriverScript)}, {RelativePath: "speaker_embedding_server.py", Content: []byte(speakerEmbeddingServerScript)}}
}
func verifySpeakerEncoderDriverBundle(root string) error {
	for _, file := range speakerEncoderDriverStaticFiles() {
		if err := verifyRegularEmbeddedFile(filepath.Join(root, file.RelativePath), file.Content, "speaker encoder Driver"); err != nil {
			return err
		}
	}
	return nil
}
func verifySpeakerEncoderProfileProbe(probe pythonDependencyProfileProbe, identity PythonDependencyProfileIdentity) error {
	if identity.AcceleratorPlane != "cpu" || identity.CUDAABI != "" || identity.TorchVersion != "" || probe.TorchVersion != "" || probe.CUDAABI != "" || probe.Device != "cpu" || probe.Allocation != 1 || len(probe.InstalledDistributions) == 0 {
		return fmt.Errorf("speaker encoder dependency profile did not execute its CPU composition")
	}
	return nil
}
