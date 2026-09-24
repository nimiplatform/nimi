package localservice

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
)

func TestResolveLocalDecisionPlanUsesOneExactProfilePerAcceleratorPlane(t *testing.T) {
	for _, target := range []struct {
		name string
		host *runtimev1.LocalDeviceProfile
		cuda bool
	}{
		{"windows-nvidia", localEnvironmentNvidiaProfile(), true},
		{"windows-cpu", &runtimev1.LocalDeviceProfile{Os: "windows", Arch: "amd64"}, false},
		{"apple-silicon", &runtimev1.LocalDeviceProfile{Os: "darwin", Arch: "arm64", Gpu: &runtimev1.LocalGpuProfile{Available: true, Vendor: "apple"}}, false},
	} {
		t.Run(target.name, func(t *testing.T) {
			svc := newLocalEnvironmentTestService(t)
			defer svc.Close()
			svc.SetEngineManager(&mockEngineManager{})
			pack, consumer, ok := localEnvironmentTargetForDriver(capabilitydriver.LayaDriver{}, localEnvironmentHostProfileFromDeviceProfile(target.host))
			if !ok || pack != localDecisionPackID || consumer != engine.TextDecisionConsumerID {
				t.Fatalf("Laya environment target: %q %q %v", pack, consumer, ok)
			}
			plan := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{PackID: pack, ConsumerScope: consumer, HostProfile: target.host, RuntimeDataRoot: svc.runtimeDataRoot})
			if plan.State == localEnvironmentStateUnsupported || plan.ProductLabel != "Decisions" {
				t.Fatalf("decision plan: %+v", plan)
			}
			venv := findLocalEnvironmentDependency(t, plan, localEnvironmentFamilyPythonVenv)
			packages := findLocalEnvironmentDependency(t, plan, localEnvironmentFamilyPythonPackageSet)
			if venv.DependencyID != packages.DependencyID || packages.ConsumerScope != engine.TextDecisionConsumerID {
				t.Fatalf("decision profile capture differs: %+v %+v", venv, packages)
			}
			plane := "cpu"
			if target.cuda {
				plane = "cuda"
			}
			identity, err := engine.ResolvePythonDependencyProfileIdentity(engine.TextDecisionConsumerID, localEnvironmentPlatformTuple(localEnvironmentHostProfileFromDeviceProfile(target.host)), plane)
			if err != nil || venv.DependencyID != identity.DependencyID {
				t.Fatalf("decision profile is not the %s plane profile: %+v %v", plane, venv, err)
			}
			torch := findLocalEnvironmentDependency(t, plan, localEnvironmentFamilyPythonTorchWheel)
			if torch.ConsumerScope != engine.TextDecisionConsumerID+"."+plane || !torch.Required || torch.State == localEnvironmentStateUnsupported {
				t.Fatalf("decision torch projection: %+v", torch)
			}
			cuda := findLocalEnvironmentDependency(t, plan, localEnvironmentFamilyCUDA)
			if cuda.Required != target.cuda {
				t.Fatalf("decision CUDA requiredness: %+v", cuda)
			}
			if requirement, ok := localEnvironmentConsumerRequirementByID(engine.TextDecisionConsumerID + "." + plane); !ok || requirement.PackID != localDecisionPackID {
				t.Fatalf("activation gate consumer: %+v %v", requirement, ok)
			}
		})
	}
	if pythonTorchWheelPrerequisiteConsumer(engine.TextDecisionConsumerID+".cuda") != engine.TextDecisionConsumerID ||
		!pythonMaterializerConsumerScope(engine.TextDecisionConsumerID+".cpu") {
		t.Fatal("decision torch plane scopes are not Python materializer consumers")
	}
}
