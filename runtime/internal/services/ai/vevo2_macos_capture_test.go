package ai

import (
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"path/filepath"
	"testing"
)

func TestMacAudioCppCaptureRequiresExactVeVo2SourceAndNoCUDA(t *testing.T) {
	root := t.TempDir()
	selected := &localexecution.SelectedLocalExecution{CapabilityContract: capabilitydriver.VoiceConvertCapabilityContract, DriverIdentity: (&capabilitydriver.Identity{ImplementationID: capabilitydriver.VeVo2ImplementationID, DriverID: capabilitydriver.VeVo2DriverID, DriverDialect: capabilitydriver.VeVo2DriverDialect}).Proto(), ExactDependencySources: []localexecution.ExactDependencySource{{DependencyFamily: "native-engine-package.audio-cpp", DependencyID: "audio.cpp.package", ConsumerScope: "audio.cpp.vevo2.cpu", Version: "release-0.8.1@f2b4937306daa25f5c78520f3c626ed31495a37a", SelectedSourceRecordID: "mac-native", CanonicalRoot: root, VerifiedArtifacts: []string{filepath.Join(root, "audiocpp_cli")}}}}
	pkg, err := audioCppRuntimePackageInput(selected)
	if err != nil || pkg.AudioCppPackageID != capabilitydriver.AudioCppMacOSPackageID || pkg.CUDA13Root != "" {
		t.Fatalf("capture=%+v err=%v", pkg, err)
	}
	selected.DriverIdentity.DriverId = capabilitydriver.SeedVCDriverID
	if _, err := audioCppRuntimePackageInput(selected); err == nil {
		t.Fatal("Mac native package widened to another Driver")
	}
	selected.DriverIdentity.DriverId = capabilitydriver.VeVo2DriverID
	selected.ExactDependencySources = append(selected.ExactDependencySources, localexecution.ExactDependencySource{DependencyFamily: "accelerator.cuda.runtime", DependencyID: capabilitydriver.AudioCppCUDA13RuntimeDependencyID, SelectedSourceRecordID: "cuda", CanonicalRoot: root})
	if _, err := audioCppRuntimePackageInput(selected); err == nil {
		t.Fatal("CPU capture silently discarded CUDA source")
	}
}
