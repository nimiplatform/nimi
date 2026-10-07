package engine

import (
	_ "embed"
	"fmt"
	"path/filepath"

	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

const BasicPitchConsumerID = capabilitydriver.BasicPitchConsumerID

//go:embed assets/basic_pitch_driver.py
var basicPitchDriver string

//go:embed assets/basic_pitch_decoder.py
var basicPitchDecoder string

//go:embed assets/basic_pitch_LICENSE
var basicPitchLicense string

//go:embed assets/basic_pitch_NOTICE
var basicPitchNotice string

func basicPitchDriverStaticFiles() []PythonDependencyProfileStaticFile {
	return []PythonDependencyProfileStaticFile{
		{RelativePath: "basic_pitch_driver.py", Content: []byte(basicPitchDriver)},
		{RelativePath: "basic_pitch_decoder.py", Content: []byte(basicPitchDecoder)},
		{RelativePath: "basic_pitch_LICENSE", Content: []byte(basicPitchLicense)},
		{RelativePath: "basic_pitch_NOTICE", Content: []byte(basicPitchNotice)},
	}
}

func verifyBasicPitchDriverBundle(root string) error {
	for _, file := range basicPitchDriverStaticFiles() {
		if err := verifyRegularEmbeddedFile(filepath.Join(root, file.RelativePath), file.Content, "Basic Pitch Driver"); err != nil {
			return err
		}
	}
	return nil
}

// @nimi-authority: rule.nimi.runtime.ai-provider.basic-pitch-onnx-note-events
func verifyBasicPitchProfileProbe(probe pythonDependencyProfileProbe, identity PythonDependencyProfileIdentity) error {
	if (identity.PlatformTuple != "windows/amd64" && identity.PlatformTuple != "darwin/arm64") || identity.AcceleratorPlane != "cpu" || identity.TorchVersion != "" || identity.CUDAABI != "" || probe.TorchVersion != "" || probe.CUDAABI != "" || probe.Device != "cpu" || probe.Allocation != 1 || probe.ONNXRuntimeVersion != "1.20.1" || len(probe.InstalledDistributions) == 0 {
		return fmt.Errorf("Basic Pitch profile did not verify its exact ONNX CPU composition")
	}
	return nil
}
