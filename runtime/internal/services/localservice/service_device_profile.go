package localservice

import (
	"context"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/status"
)

func (s *Service) CollectDeviceProfile(ctx context.Context, request *runtimev1.CollectDeviceProfileRequest) (*runtimev1.CollectDeviceProfileResponse, error) {
	var extraPorts []int32
	if request != nil {
		extraPorts = request.GetExtraPorts()
	}
	profile := collectDeviceProfile(ctx, extraPorts...)
	if err := ctx.Err(); err != nil {
		return nil, status.FromContextError(err).Err()
	}
	return &runtimev1.CollectDeviceProfileResponse{Profile: profile}, nil
}
