package localservice

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
)

func TestSpacyTransformerPlansIndependentCPUTorchEnvironment(t *testing.T) {
	svc := newLocalEnvironmentTestService(t)
	defer svc.Close()
	host := localEnvironmentNvidiaProfile()
	pack, consumer, ok := localEnvironmentTargetForDriver(capabilitydriver.SpacyTrfDriver{}, localEnvironmentHostProfileFromDeviceProfile(host))
	if !ok || pack != "local-nlp-transformer" || consumer != engine.TextAnnotationTrfConsumerID {
		t.Fatalf("transformer environment target: %q %q %v", pack, consumer, ok)
	}
	plan := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{PackID: pack, ConsumerScope: consumer, HostProfile: host, RuntimeDataRoot: svc.runtimeDataRoot})
	venv := findLocalEnvironmentDependency(t, plan, localEnvironmentFamilyPythonVenv)
	packages := findLocalEnvironmentDependency(t, plan, localEnvironmentFamilyPythonPackageSet)
	torch := findLocalEnvironmentDependency(t, plan, localEnvironmentFamilyPythonTorchWheel)
	identity, err := engine.ResolvePythonDependencyProfileIdentity(consumer, "windows/amd64", "cpu")
	if err != nil || venv.DependencyID != identity.DependencyID || packages.DependencyID != identity.DependencyID || torch.ConsumerScope != consumer+".cpu" || !torch.Required {
		t.Fatalf("transformer environment did not capture one CPU profile and Torch source: %+v %+v %+v %v", venv, packages, torch, err)
	}
	if pythonTorchWheelPrerequisiteConsumer(consumer+".cpu") != consumer || !pythonMaterializerConsumerScope(consumer+".cpu") {
		t.Fatal("transformer Torch prerequisite lost its profile consumer")
	}
	if requirement, ok := localEnvironmentConsumerRequirementByID(consumer + ".cpu"); !ok || requirement.PackID != pack {
		t.Fatalf("transformer Torch activation gate: %+v %v", requirement, ok)
	}
	svc.mu.Lock()
	svc.localEnvironmentDependencyJobs["old-transformer-refusal"] = localEnvironmentDependencyJobState{
		JobID: "old-transformer-refusal", EnvironmentKey: torch.EnvironmentKey,
		DependencyFamily: torch.DependencyFamily, DependencyID: torch.DependencyID, ConsumerScope: torch.ConsumerScope,
		State: localEnvironmentStateUnsupported, SourceKind: localEnvironmentSourceUnavailable,
		UpdatedAt: "2026-09-28T00:00:00Z",
	}
	svc.mu.Unlock()
	refreshed := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{PackID: pack, ConsumerScope: consumer, HostProfile: host, RuntimeDataRoot: svc.runtimeDataRoot})
	refreshedTorch := findLocalEnvironmentDependency(t, refreshed, localEnvironmentFamilyPythonTorchWheel)
	if refreshedTorch.State == localEnvironmentStateUnsupported || refreshed.State == localEnvironmentStateUnsupported {
		t.Fatalf("an old unsupported job masked the current supported transformer plan: %+v", refreshedTorch)
	}
	if _, _, ok := localEnvironmentTargetForDriver(capabilitydriver.SpacyTrfDriver{}, localEnvironmentHostProfileFromDeviceProfile(&runtimev1.LocalDeviceProfile{Os: "darwin", Arch: "arm64"})); ok {
		t.Fatal("unverified macOS transformer host was offered")
	}
}
