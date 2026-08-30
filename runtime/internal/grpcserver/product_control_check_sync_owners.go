package grpcserver

import (
	"context"
	"path/filepath"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appstorage"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
	appservice "github.com/nimiplatform/nimi/runtime/internal/services/app"
	cognitionservice "github.com/nimiplatform/nimi/runtime/internal/services/cognition"
	"github.com/nimiplatform/nimi/runtime/internal/services/localservice"
	runtimeagentservice "github.com/nimiplatform/nimi/runtime/internal/services/runtimeagent"
)

func productControlCheckSyncOwners(
	backend *runtimepersistence.Backend,
	kernel *localappkernel.Kernel,
	cognition *cognitionservice.Service,
	apps *appservice.Service,
	account localservice.RuntimeAccountProjectionProvider,
	agent *runtimeagentservice.Service,
) localservice.ProductControlCheckSyncRuntimeOwners {
	return localservice.ProductControlCheckSyncRuntimeOwners{
		AccountGeneration: func(ctx context.Context) (uint64, bool) {
			provider, ok := account.(interface {
				AuthenticatedRuntimeSecurityContext(context.Context) (*runtimev1.AccountProjection, uint64, bool)
			})
			if !ok {
				return 0, false
			}
			_, generation, authenticated := provider.AuthenticatedRuntimeSecurityContext(ctx)
			return generation, authenticated && generation != 0
		},
		RuntimeAgent: func(ctx context.Context, input localservice.ProductControlCheckSyncInput) localservice.ProductControlCheckSyncOwnerResult {
			result := completedCheckSyncOwner("runtime_agent")
			if input.AccountGeneration != 0 && !checkSyncAccountGenerationMatches(ctx, account, input.AccountGeneration) {
				result.Resources = append(result.Resources, checkSyncResource("runtime_owner_account", "unavailable", "RUNTIME_OWNER_ACCOUNT_CONTEXT_CHANGED"))
				return result
			}
			if backend == nil || backend.DB() == nil || agent == nil || !pathWithinCheckSyncRoot(backend.Path(), filepath.Join(input.DataRoot, "accounts", "runtime")) {
				result.Resources = append(result.Resources, checkSyncResource("runtime_owner_store", "failed", "RUNTIME_OWNER_STORE_ROOT_MISMATCH"))
				result.State = "failed"
				return result
			}
			resources, err := agent.CheckSyncDataRoot(ctx, input.DataRoot)
			if err != nil {
				result.Resources = append(result.Resources, checkSyncResource("runtime_owner_store", "failed", "RUNTIME_OWNER_STORE_UNAVAILABLE"))
				result.State = "failed"
				return result
			}
			if input.AccountGeneration != 0 && !checkSyncAccountGenerationMatches(ctx, account, input.AccountGeneration) {
				result.Resources = []localservice.ProductControlCheckSyncResourceResult{
					checkSyncResource("runtime_owner_account", "unavailable", "RUNTIME_OWNER_ACCOUNT_CONTEXT_CHANGED"),
				}
				return result
			}
			for _, ownerResource := range resources {
				result.Resources = append(result.Resources, checkSyncResource(ownerResource.Kind, ownerResource.Status, ownerResource.Reason))
			}
			return result
		},
		RegisteredApps: func(ctx context.Context, _ localservice.ProductControlCheckSyncInput) localservice.ProductControlCheckSyncOwnerResult {
			result := completedCheckSyncOwner("registered_apps")
			if kernel == nil {
				result.Resources = append(result.Resources, checkSyncResource("registered_app_subject", "unavailable", "REGISTERED_APP_OWNER_UNAVAILABLE"))
				return result
			}
			statuses, err := kernel.Registrations().ListStatuses(ctx)
			if err != nil {
				result.State = "failed"
				result.Resources = append(result.Resources, checkSyncResource("registered_app_subject", "failed", "REGISTERED_APP_OWNER_CHECK_FAILED"))
				return result
			}
			for _, status := range statuses {
				resource := checkSyncResource("registered_app_subject", "unavailable", "REGISTERED_APP_HOST_BINDING_UNAVAILABLE")
				if appID := strings.TrimSpace(status.AppID); appID != "" {
					resource.Reference = &appID
				}
				switch {
				case status.State == localappkernel.RegistrationStateTombstoned:
					resource.Reason = "REGISTERED_APP_TOMBSTONED"
				case status.CurrentHostBound && status.Available:
					resource.Status = "available"
					resource.Reason = "REGISTERED_APP_SUBJECT_REOPENED"
				}
				result.Resources = append(result.Resources, resource)
			}
			return result
		},
		Cognition: func(ctx context.Context, input localservice.ProductControlCheckSyncInput) localservice.ProductControlCheckSyncOwnerResult {
			result := completedCheckSyncOwner("cognition")
			if cognition == nil {
				result.Resources = append(result.Resources, checkSyncResource("cognition_owner", "unavailable", "COGNITION_OWNER_UNAVAILABLE"))
				return result
			}
			resources, err := cognition.CheckSyncDataRoot(ctx, input.DataRoot)
			if err != nil {
				result.State = "failed"
				result.Resources = append(result.Resources, checkSyncResource("cognition_owner", "failed", "COGNITION_OWNER_INSPECTION_FAILED"))
				return result
			}
			for _, ownerResource := range resources {
				result.Resources = append(result.Resources, checkSyncResource(ownerResource.Kind, ownerResource.Status, ownerResource.Reason))
			}
			return result
		},
		ManagedAppStorage: func(ctx context.Context, input localservice.ProductControlCheckSyncInput) localservice.ProductControlCheckSyncOwnerResult {
			result := completedCheckSyncOwner("managed_app_storage")
			if apps == nil {
				result.State = "failed"
				result.Resources = append(result.Resources, checkSyncResource("managed_app_storage", "failed", "APP_STORAGE_OWNER_UNAVAILABLE"))
				return result
			}
			if kernel == nil || account == nil {
				result.Resources = append(result.Resources, checkSyncResource("managed_app_storage", "unavailable", "APP_STORAGE_OWNER_BINDING_UNAVAILABLE"))
				return result
			}
			if err := apps.CheckSyncDataRoot(input.DataRoot); err != nil {
				result.State = "failed"
				result.Resources = append(result.Resources, checkSyncResource("managed_app_storage", "failed", "APP_STORAGE_ROOT_MISMATCH"))
				return result
			}
			provider, generationProvider := account.(interface {
				AuthenticatedRuntimeSecurityContext(context.Context) (*runtimev1.AccountProjection, uint64, bool)
			})
			projection, generation, ok := (*runtimev1.AccountProjection)(nil), uint64(0), false
			if generationProvider {
				projection, generation, ok = provider.AuthenticatedRuntimeSecurityContext(ctx)
			} else {
				projection, ok = account.AuthenticatedRuntimeProjection(ctx)
			}
			if !ok || projection == nil || strings.TrimSpace(projection.GetAccountId()) == "" ||
				(input.AccountGeneration != 0 && generation != input.AccountGeneration) {
				result.Resources = append(result.Resources, checkSyncResource("managed_app_storage", "unavailable", "APP_STORAGE_ACCOUNT_REAUTH_REQUIRED"))
				return result
			}
			statuses, err := kernel.Registrations().ListStatuses(ctx)
			if err != nil {
				result.State = "failed"
				result.Resources = append(result.Resources, checkSyncResource("managed_app_storage", "failed", "APP_STORAGE_REGISTRATION_OWNER_CHECK_FAILED"))
				return result
			}
			for _, registration := range statuses {
				resource := checkSyncResource("managed_app_storage", "unavailable", "APP_STORAGE_SUBJECT_UNAVAILABLE")
				if appID := strings.TrimSpace(registration.AppID); appID != "" {
					resource.Reference = &appID
				}
				if registration.State == localappkernel.RegistrationStateActive {
					if !registration.CurrentHostBound || !registration.Available {
						resource.Reason = "APP_STORAGE_CROSS_HOST_BINDING_UNAVAILABLE"
						result.Resources = append(result.Resources, resource)
						continue
					}
					exists, inspectErr := apps.CheckSyncManagedOwner(ctx, input.DataRoot, appstorage.ManagedOwner{
						AccountID: projection.GetAccountId(), RegisteredAppSubject: registration.RegisteredAppSubject,
					})
					switch {
					case inspectErr != nil:
						resource.Status = "conflict"
						resource.Reason = "APP_STORAGE_OWNER_RECONCILIATION_FAILED"
					case exists:
						resource.Status = "available"
						resource.Reason = "APP_STORAGE_PARTITION_REOPENED"
					default:
						resource.Reason = "APP_STORAGE_PARTITION_MISSING"
					}
				}
				result.Resources = append(result.Resources, resource)
			}
			if len(result.Resources) == 0 {
				result.Resources = append(result.Resources, checkSyncResource("managed_app_storage", "available", "APP_STORAGE_OWNER_EMPTY"))
			}
			return result
		},
	}
}

func completedCheckSyncOwner(ownerID string) localservice.ProductControlCheckSyncOwnerResult {
	return localservice.ProductControlCheckSyncOwnerResult{
		OwnerID: ownerID, State: "completed", Resources: []localservice.ProductControlCheckSyncResourceResult{},
	}
}

func checkSyncResource(kind string, status string, reason string) localservice.ProductControlCheckSyncResourceResult {
	return localservice.ProductControlCheckSyncResourceResult{Kind: kind, Status: status, Reason: reason}
}

func checkSyncAccountGenerationMatches(ctx context.Context, account localservice.RuntimeAccountProjectionProvider, expected uint64) bool {
	provider, ok := account.(interface {
		AuthenticatedRuntimeSecurityContext(context.Context) (*runtimev1.AccountProjection, uint64, bool)
	})
	if !ok || expected == 0 {
		return false
	}
	_, generation, authenticated := provider.AuthenticatedRuntimeSecurityContext(ctx)
	return authenticated && generation == expected
}

func pathWithinCheckSyncRoot(candidate string, root string) bool {
	candidate = filepath.Clean(strings.TrimSpace(candidate))
	root = filepath.Clean(strings.TrimSpace(root))
	if candidate == "." || root == "." || !filepath.IsAbs(candidate) || !filepath.IsAbs(root) {
		return false
	}
	relative, err := filepath.Rel(root, candidate)
	if err != nil || filepath.IsAbs(relative) || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return false
	}
	return true
}
