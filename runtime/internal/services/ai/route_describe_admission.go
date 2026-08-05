package ai

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
)

// routeDescribeJobRequest adapts the shared Scenario envelope to the cloud
// media/voice admission carrier. It does not create a job or execution path.
func routeDescribeJobRequest(req *runtimev1.ExecuteScenarioRequest) *runtimev1.SubmitScenarioJobRequest {
	if req == nil {
		return nil
	}
	spec, _ := proto.Clone(req.GetSpec()).(*runtimev1.ScenarioSpec)
	extensions := make([]*runtimev1.ScenarioExtension, 0, len(req.GetExtensions()))
	for _, extension := range req.GetExtensions() {
		cloned, _ := proto.Clone(extension).(*runtimev1.ScenarioExtension)
		if cloned != nil {
			extensions = append(extensions, cloned)
		}
	}
	return &runtimev1.SubmitScenarioJobRequest{
		Head:          cloneScenarioHead(req.GetHead()),
		ScenarioType:  req.GetScenarioType(),
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		Spec:          spec,
		Extensions:    extensions,
	}
}
