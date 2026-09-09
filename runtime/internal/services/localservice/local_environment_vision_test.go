package localservice

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
	"testing"
)

func TestResolveLocalVisionPlanUsesOneExactProfile(t *testing.T) {
	for _, target := range []struct {
		name string
		host *runtimev1.LocalDeviceProfile
		cuda bool
	}{
		{"windows", localEnvironmentNvidiaProfile(), true},
		{"apple-silicon", &runtimev1.LocalDeviceProfile{Os: "darwin", Arch: "arm64", Gpu: &runtimev1.LocalGpuProfile{Available: true, Vendor: "apple"}}, false},
	} {
		t.Run(target.name, func(t *testing.T) {
			svc := newLocalEnvironmentTestService(t)
			defer svc.Close()
			svc.SetEngineManager(&mockEngineManager{})
			plan := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{PackID: "local-vision", ConsumerScope: engine.VisionLocateConsumerID, HostProfile: target.host, RuntimeDataRoot: svc.runtimeDataRoot})
			if plan.State == localEnvironmentStateUnsupported {
				t.Fatalf("Locate plan is unsupported: %+v", plan)
			}
			venv := findLocalEnvironmentDependency(t, plan, localEnvironmentFamilyPythonVenv)
			packages := findLocalEnvironmentDependency(t, plan, localEnvironmentFamilyPythonPackageSet)
			if venv.DependencyID != packages.DependencyID || packages.ConsumerScope != engine.VisionLocateConsumerID {
				t.Fatalf("Locate profile capture differs: %+v %+v", venv, packages)
			}
			torch := findLocalEnvironmentDependency(t, plan, localEnvironmentFamilyPythonTorchWheel)
			plane := "cpu"
			if target.cuda {
				plane = "cuda"
			}
			if torch.ConsumerScope != engine.VisionLocateConsumerID+"."+plane || !torch.Required {
				t.Fatalf("Locate torch projection: %+v", torch)
			}
			cuda := findLocalEnvironmentDependency(t, plan, localEnvironmentFamilyCUDA)
			if cuda.Required != target.cuda {
				t.Fatalf("Locate CUDA requiredness: %+v", cuda)
			}
		})
	}
}
