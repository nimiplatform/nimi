package ai

import (
	"fmt"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

type imageFaceSwapPlanner interface {
	PlanImageFaceSwapInvocation(string, string, []byte, []byte, []capabilitydriver.InvocationExactBinding, []capabilitydriver.InvocationExactDependencySource) (*capabilitydriver.ImageFaceSwapInvocationPlan, error)
}
type videoFaceSwapPlanner interface {
	PlanVideoFaceSwapInvocation(string, string, []byte, []byte, string, []capabilitydriver.InvocationExactBinding, []capabilitydriver.InvocationExactDependencySource) (*capabilitydriver.VideoFaceSwapInvocationPlan, error)
	PlanVideoFaceSwapSession(string, string, []byte, []capabilitydriver.InvocationExactBinding, []capabilitydriver.InvocationExactDependencySource) (capabilitydriver.FaceSwapModelPlan, error)
}

func restoredFaceSwapDriver(a *localResolvedAssembly) (capabilitydriver.Driver, error) {
	d, reason := capabilitydriver.NewProductionRegistry().Resolve(a.CapabilityContract, capabilitydriver.Identity{ImplementationID: a.DriverIdentity.ImplementationID, DriverID: a.DriverIdentity.DriverID, DriverDialect: a.DriverIdentity.DriverDialect})
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		return nil, fmt.Errorf("captured exact face replacement Driver is not registered")
	}
	return d, nil
}
func restoredImageFaceSwapPlanner(a *localResolvedAssembly) (imageFaceSwapPlanner, error) {
	d, e := restoredFaceSwapDriver(a)
	if e != nil {
		return nil, e
	}
	p, ok := d.(imageFaceSwapPlanner)
	if !ok {
		return nil, fmt.Errorf("captured Driver has no image face plan")
	}
	return p, nil
}
func restoredVideoFaceSwapPlanner(a *localResolvedAssembly) (videoFaceSwapPlanner, error) {
	d, e := restoredFaceSwapDriver(a)
	if e != nil {
		return nil, e
	}
	p, ok := d.(videoFaceSwapPlanner)
	if !ok {
		return nil, fmt.Errorf("captured Driver has no video face plan")
	}
	return p, nil
}
