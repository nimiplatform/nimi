package app

import (
	"context"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func (s *Service) GetLocalDevelopmentAuthoritySummary(ctx context.Context, _ *runtimev1.GetLocalDevelopmentAuthoritySummaryRequest) (*runtimev1.GetLocalDevelopmentAuthoritySummaryResponse, error) {
	if err := requireProtectedLocalDevelopmentDesktop(ctx); err != nil {
		return nil, err
	}
	response := &runtimev1.GetLocalDevelopmentAuthoritySummaryResponse{
		DeveloperMode:        unavailableDeveloperModeSummary(runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE),
		ProjectAuthorization: unavailableProjectAuthorizationSummary(runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE),
		ReasonCode:           runtimev1.ReasonCode_ACTION_EXECUTED,
	}
	if s == nil {
		return response, nil
	}
	if s.localDevelopment != nil {
		if mode, err := s.localDevelopment.DeveloperMode(ctx); err == nil {
			state := runtimev1.DeveloperModeState_DEVELOPER_MODE_STATE_DISABLED
			if mode.Enabled {
				state = runtimev1.DeveloperModeState_DEVELOPER_MODE_STATE_ENABLED
			}
			response.DeveloperMode = &runtimev1.LocalDevelopmentDeveloperModeSummary{
				Availability: runtimev1.LocalDevelopmentSummaryAvailability_LOCAL_DEVELOPMENT_SUMMARY_AVAILABILITY_AVAILABLE,
				State:        state,
				ReasonCode:   runtimev1.ReasonCode_ACTION_EXECUTED,
			}
		}
	}
	account, _, authenticated := s.authenticatedRuntimeAccount(ctx)
	if !authenticated {
		response.ProjectAuthorization = unavailableProjectAuthorizationSummary(runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
		return response, nil
	}
	accountID := account.GetAccountId()
	if s.localDevelopment != nil {
		if authorizations, err := s.localDevelopment.List(ctx); err == nil {
			summary := &runtimev1.LocalDevelopmentProjectAuthorizationSummary{
				Availability: runtimev1.LocalDevelopmentSummaryAvailability_LOCAL_DEVELOPMENT_SUMMARY_AVAILABILITY_AVAILABLE,
				ReasonCode:   runtimev1.ReasonCode_ACTION_EXECUTED,
			}
			valid := true
			for _, authorization := range authorizations {
				if authorization.Project.AccountID != accountID {
					continue
				}
				switch authorization.State {
				case localDevelopmentAuthorizationActive:
					summary.ActiveCount++
				case localDevelopmentAuthorizationDenied:
					summary.DeniedCount++
				case localDevelopmentAuthorizationRevoked:
					summary.RevokedCount++
				default:
					valid = false
				}
			}
			if valid {
				response.ProjectAuthorization = summary
			}
		}
	}
	return response, nil
}

func unavailableDeveloperModeSummary(reason runtimev1.ReasonCode) *runtimev1.LocalDevelopmentDeveloperModeSummary {
	return &runtimev1.LocalDevelopmentDeveloperModeSummary{
		Availability: runtimev1.LocalDevelopmentSummaryAvailability_LOCAL_DEVELOPMENT_SUMMARY_AVAILABILITY_UNAVAILABLE,
		State:        runtimev1.DeveloperModeState_DEVELOPER_MODE_STATE_UNAVAILABLE,
		ReasonCode:   reason,
	}
}

func unavailableProjectAuthorizationSummary(reason runtimev1.ReasonCode) *runtimev1.LocalDevelopmentProjectAuthorizationSummary {
	return &runtimev1.LocalDevelopmentProjectAuthorizationSummary{
		Availability: runtimev1.LocalDevelopmentSummaryAvailability_LOCAL_DEVELOPMENT_SUMMARY_AVAILABILITY_UNAVAILABLE,
		ReasonCode:   reason,
	}
}
