package engine

import (
	_ "embed"
	"fmt"
	"path/filepath"

	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

const FaceSwapConsumerID = capabilitydriver.InsightFaceConsumerID

//go:embed assets/face_swap.py
var faceSwapScript string

//go:embed assets/face_swap_server.py
var faceSwapServerScript string

//go:embed assets/face_swap_video.py
var faceSwapVideoScript string

func faceSwapDriverStaticFiles() []PythonDependencyProfileStaticFile {
	return []PythonDependencyProfileStaticFile{
		{RelativePath: "face_swap.py", Content: []byte(faceSwapScript)},
		{RelativePath: "face_swap_server.py", Content: []byte(faceSwapServerScript)},
		{RelativePath: "face_swap_video.py", Content: []byte(faceSwapVideoScript)},
	}
}

func verifyFaceSwapDriverBundle(root string) error {
	for _, file := range faceSwapDriverStaticFiles() {
		if err := verifyRegularEmbeddedFile(filepath.Join(root, file.RelativePath), file.Content, "face replacement Driver"); err != nil {
			return err
		}
	}
	return nil
}

func verifyFaceSwapProfileProbe(probe pythonDependencyProfileProbe, identity PythonDependencyProfileIdentity) error {
	if identity.PlatformTuple != "windows/amd64" || identity.AcceleratorPlane != "cuda" || identity.CUDAABI != "cu13" || identity.TorchVersion != "" ||
		probe.ONNXRuntimeVersion != "1.28.0" || probe.TorchVersion != "" || probe.CUDAABI != "13" || probe.Device != "cuda" || probe.Allocation != 1 || len(probe.InstalledDistributions) == 0 {
		return fmt.Errorf("face replacement dependency profile did not execute with its exact ONNX Runtime CUDA composition")
	}
	return nil
}
