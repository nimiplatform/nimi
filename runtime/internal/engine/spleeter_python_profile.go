package engine

import (
	_ "embed"
	"fmt"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"path/filepath"
)

const SpleeterConsumerID = capabilitydriver.SpleeterConsumerID

//go:embed assets/spleeter_driver.py
var spleeterDriver string

//go:embed assets/spleeter_LICENSE
var spleeterLicense string

func spleeterDriverStaticFiles() []PythonDependencyProfileStaticFile {
	return []PythonDependencyProfileStaticFile{{RelativePath: "spleeter_driver.py", Content: []byte(spleeterDriver)}, {RelativePath: "spleeter_LICENSE", Content: []byte(spleeterLicense)}}
}
func verifySpleeterDriverBundle(root string) error {
	for _, f := range spleeterDriverStaticFiles() {
		if e := verifyRegularEmbeddedFile(filepath.Join(root, f.RelativePath), f.Content, "Spleeter Driver"); e != nil {
			return e
		}
	}
	return nil
}
func verifySpleeterProfileProbe(p pythonDependencyProfileProbe, id PythonDependencyProfileIdentity) error {
	if id.PlatformTuple != "windows/amd64" || id.AcceleratorPlane != "cpu" || id.TorchVersion != "" || id.CUDAABI != "" || p.TorchVersion != "" || p.CUDAABI != "" || p.Device != "cpu" || p.Allocation != 1 || p.TensorFlowVersion != "2.16.1" || len(p.InstalledDistributions) == 0 {
		return fmt.Errorf("Spleeter profile did not verify its fixed TensorFlow CPU composition")
	}
	return nil
}
