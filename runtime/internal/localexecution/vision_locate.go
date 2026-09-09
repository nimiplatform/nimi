package localexecution

import (
	"context"
	"fmt"
	"math"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"google.golang.org/protobuf/proto"
)

const MaxVisionLocateResultBytes = 256 * 1024

type VisionExecutionHost interface {
	ExecuteVisionLocate(context.Context, *capabilitydriver.VisionLocateInvocationPlan, func() error) (*runtimev1.VisionLocateResult, error)
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r127
func ValidateVisionLocateResult(result *runtimev1.VisionLocateResult, request *runtimev1.VisionLocateScenarioSpec, width, height uint32) error {
	if result == nil || request == nil || width == 0 || height == 0 || result.GetImageArtifactId() != request.GetImageArtifactId() || result.Width != width || result.Height != height {
		return fmt.Errorf("Locate result does not match its captured image")
	}
	if proto.Size(result) > MaxVisionLocateResultBytes {
		return fmt.Errorf("Locate result exceeds its size bound")
	}
	finite := func(values ...float64) bool {
		for _, value := range values {
			if math.IsNaN(value) || math.IsInf(value, 0) || value < 0 || value > 1 {
				return false
			}
		}
		return true
	}
	for _, location := range result.Locations {
		if location == nil {
			return fmt.Errorf("Locate result has a missing location")
		}
		switch request.GetGeometry() {
		case runtimev1.VisionLocateGeometry_VISION_LOCATE_GEOMETRY_BOX:
			box := location.GetBox()
			if box == nil || !finite(box.X1, box.Y1, box.X2, box.Y2) || box.X1 >= box.X2 || box.Y1 >= box.Y2 {
				return fmt.Errorf("Locate result has an invalid box")
			}
		case runtimev1.VisionLocateGeometry_VISION_LOCATE_GEOMETRY_POINT:
			point := location.GetPoint()
			if point == nil || !finite(point.X, point.Y) {
				return fmt.Errorf("Locate result has an invalid point")
			}
		default:
			return fmt.Errorf("Locate geometry is not admitted")
		}
	}
	return nil
}
