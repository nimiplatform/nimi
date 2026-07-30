package localservice

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func localEnvironmentCPUProfileForTest() *runtimev1.LocalDeviceProfile {
	return &runtimev1.LocalDeviceProfile{
		Os:     "linux",
		Arch:   "amd64",
		Gpu:    &runtimev1.LocalGpuProfile{Available: false},
		Python: &runtimev1.LocalPythonProfile{Available: true, Version: "3.11.6"},
	}
}

func TestLocalEnvironmentHostProfileIDIgnoresVolatileSystemPythonVersion(t *testing.T) {
	originalProfile := localEnvironmentCPUProfileForTest()
	driftedProfile := localEnvironmentCPUProfileForTest()
	driftedProfile.Python.Version = "Python 3.14.2"

	originalID := localEnvironmentHostProfileFromDeviceProfile(originalProfile).HostProfileID
	driftedID := localEnvironmentHostProfileFromDeviceProfile(driftedProfile).HostProfileID
	if originalID != driftedID {
		t.Fatalf("host profile id changed for system python version drift: original=%q drifted=%q", originalID, driftedID)
	}
}
