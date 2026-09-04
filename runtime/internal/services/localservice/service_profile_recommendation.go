package localservice

import (
	"context"
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/platformcatalog"
	"google.golang.org/grpc/codes"
)

// @nimi-authority: rule.nimi.platform.core-protocol.p-aips-004a
func (s *Service) ListFactoryProfileRecommendations(
	_ context.Context,
	req *runtimev1.ListFactoryProfileRecommendationsRequest,
) (*runtimev1.ListFactoryProfileRecommendationsResponse, error) {
	filter := ""
	if req != nil {
		filter = strings.TrimSpace(req.GetCapabilityContract())
	}
	profiles, err := projectFactoryProfileRecommendations(
		platformcatalog.FactoryAIProfileRows,
		filter,
		s.deviceProfileSnapshot(),
	)
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID, err, grpcerr.ReasonOptions{Message: "factory Profile recommendation filter is invalid"})
	}
	return &runtimev1.ListFactoryProfileRecommendationsResponse{Profiles: profiles}, nil
}

func projectFactoryProfileRecommendations(
	rows []platformcatalog.FactoryAIProfileRow,
	filter string,
	profile *runtimev1.LocalDeviceProfile,
) ([]*runtimev1.FactoryProfileRecommendation, error) {
	filter = strings.TrimSpace(filter)
	if filter != "" && !factoryCatalogDeclaresCapability(rows, filter) {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	hostProfileID := factoryRecommendationHostProfileID(profile)
	result := make([]*runtimev1.FactoryProfileRecommendation, 0, len(rows))
	for _, row := range rows {
		if filter != "" && !stringSetContains(row.CapabilitySet, filter) {
			continue
		}
		capabilities := row.CapabilitySet
		if filter != "" {
			capabilities = []string{filter}
		}
		outcomes := make([]*runtimev1.FactoryProfileCapabilityApplicability, 0, len(capabilities))
		for _, capability := range capabilities {
			applicability, reasons := factoryCapabilityApplicability(row, hostProfileID)
			outcomes = append(outcomes, &runtimev1.FactoryProfileCapabilityApplicability{
				CapabilityContract: capability,
				Applicability:      applicability,
				Reasons:            reasons,
			})
		}
		result = append(result, &runtimev1.FactoryProfileRecommendation{
			ProfileAlias: strings.TrimSpace(row.Alias),
			Capabilities: outcomes,
		})
	}
	if filter != "" {
		sort.SliceStable(result, func(i, j int) bool {
			left := filteredProfileApplicability(result[i], filter)
			right := filteredProfileApplicability(result[j], filter)
			return recommendationApplicabilityRank(left) < recommendationApplicabilityRank(right)
		})
	}
	return result, nil
}

func factoryCatalogDeclaresCapability(rows []platformcatalog.FactoryAIProfileRow, capability string) bool {
	for _, row := range rows {
		if stringSetContains(row.CapabilitySet, capability) {
			return true
		}
	}
	return false
}

func factoryCapabilityApplicability(
	row platformcatalog.FactoryAIProfileRow,
	hostProfileID string,
) (runtimev1.LocalRecommendationApplicability, []runtimev1.ReasonCode) {
	if strings.TrimSpace(hostProfileID) == "" {
		return runtimev1.LocalRecommendationApplicability_LOCAL_RECOMMENDATION_APPLICABILITY_UNKNOWN,
			[]runtimev1.ReasonCode{runtimev1.ReasonCode_AI_LOCAL_COMPONENT_COMPATIBILITY_UNKNOWN}
	}
	if stringSetContains(row.HostCapabilityProfileRefs, hostProfileID) {
		return runtimev1.LocalRecommendationApplicability_LOCAL_RECOMMENDATION_APPLICABILITY_SUPPORTED, nil
	}
	return runtimev1.LocalRecommendationApplicability_LOCAL_RECOMMENDATION_APPLICABILITY_UNSUPPORTED,
		[]runtimev1.ReasonCode{runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE}
}

func filteredProfileApplicability(
	profile *runtimev1.FactoryProfileRecommendation,
	filter string,
) runtimev1.LocalRecommendationApplicability {
	for _, capability := range profile.GetCapabilities() {
		if capability.GetCapabilityContract() == filter {
			return capability.GetApplicability()
		}
	}
	return runtimev1.LocalRecommendationApplicability_LOCAL_RECOMMENDATION_APPLICABILITY_UNSUPPORTED
}

func recommendationApplicabilityRank(value runtimev1.LocalRecommendationApplicability) int {
	switch value {
	case runtimev1.LocalRecommendationApplicability_LOCAL_RECOMMENDATION_APPLICABILITY_SUPPORTED:
		return 0
	case runtimev1.LocalRecommendationApplicability_LOCAL_RECOMMENDATION_APPLICABILITY_UNKNOWN:
		return 1
	default:
		return 2
	}
}

func factoryRecommendationHostProfileID(profile *runtimev1.LocalDeviceProfile) string {
	if profile == nil {
		return ""
	}
	osName := strings.ToLower(strings.TrimSpace(profile.GetOs()))
	arch := strings.ToLower(strings.TrimSpace(profile.GetArch()))
	switch {
	case osName == "darwin" && arch == "arm64":
		return "darwin-arm64-metal"
	case osName == "windows" && arch == "amd64":
		gpu := profile.GetGpu()
		if gpu != nil && gpu.GetAvailable() && strings.Contains(strings.ToLower(gpu.GetVendor()), "nvidia") {
			return "windows-amd64-nvidia-cuda"
		}
		return "windows-amd64-cpu"
	default:
		return ""
	}
}
