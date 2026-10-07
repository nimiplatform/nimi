package localservice

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
)

func TestBasicPitchEnvironmentPlanBindsExactNativeCPUProfile(t *testing.T) {
	for _, host := range []*runtimev1.LocalDeviceProfile{
		{Os: "windows", Arch: "amd64", Gpu: &runtimev1.LocalGpuProfile{Available: true, Vendor: "nvidia"}},
		{Os: "darwin", Arch: "arm64", Gpu: &runtimev1.LocalGpuProfile{Available: true, Vendor: "apple"}},
	} {
		t.Run(host.Os, func(t *testing.T) {
			svc := newLocalEnvironmentTestService(t)
			defer svc.Close()
			svc.SetEngineManager(&mockEngineManager{})
			pack, consumer, ok := localEnvironmentTargetForDriver(capabilitydriver.BasicPitchDriver{}, localEnvironmentHostProfileFromDeviceProfile(host))
			if !ok || pack != "local-music-notes" || consumer != engine.BasicPitchConsumerID {
				t.Fatal("Basic Pitch environment target is unavailable", pack, consumer)
			}
			plan := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{PackID: pack, ConsumerScope: consumer, HostProfile: host, RuntimeDataRoot: svc.runtimeDataRoot})
			identity, err := engine.ResolvePythonDependencyProfileIdentity(consumer, host.Os+"/"+host.Arch, "cpu")
			if err != nil || plan.State == localEnvironmentStateUnsupported {
				t.Fatal("native CPU plan is unsupported", err, plan)
			}
			for _, family := range []string{localEnvironmentFamilyPythonVenv, localEnvironmentFamilyPythonPackageSet} {
				dep := findLocalEnvironmentDependency(t, plan, family)
				if dep.DependencyID != identity.DependencyID || dep.ConsumerScope != consumer || !dep.Required || dep.State == localEnvironmentStateUnsupported {
					t.Fatalf("exact native profile not captured: %+v", dep)
				}
			}
			for _, dep := range plan.Dependencies {
				if dep.DependencyFamily == localEnvironmentFamilyCUDA || dep.DependencyFamily == localEnvironmentFamilyPythonTorchWheel || dep.DependencyFamily == localEnvironmentFamilyNativeAudioCPP {
					t.Fatal("unadmitted substrate in CPU plan", dep)
				}
			}
		})
	}
	if _, _, ok := localEnvironmentTargetForDriver(capabilitydriver.BasicPitchDriver{}, localEnvironmentHostProfileState{OS: "darwin", Arch: "amd64"}); ok {
		t.Fatal("unadmitted Intel Mac environment plan")
	}
}
