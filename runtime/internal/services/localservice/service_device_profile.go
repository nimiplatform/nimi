package localservice

import (
	"context"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func (s *Service) CollectDeviceProfile(_ context.Context, request *runtimev1.CollectDeviceProfileRequest) (*runtimev1.CollectDeviceProfileResponse, error) {
	var extraPorts []int32
	if request != nil {
		extraPorts = request.GetExtraPorts()
	}
	return &runtimev1.CollectDeviceProfileResponse{Profile: collectDeviceProfile(extraPorts...)}, nil
}
