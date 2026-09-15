package ai

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aiconfig"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/protectedprincipal"
	"google.golang.org/grpc/codes"
)

func (s *Service) captureMemoryEmbeddingIntentAndRevision(ctx context.Context) (context.Context, *runtimev1.ScenarioRequestHead, executionintent.Intent, uint64, error) {
	if s == nil || s.aiConfigStore == nil {
		return ctx, nil, executionintent.Intent{}, 0, appAIConfigPersistenceError(fmt.Errorf("AIConfig store is unavailable"))
	}
	accountID := memoryEmbeddingAccountID(ctx)
	if accountID == "" {
		return ctx, nil, executionintent.Intent{}, 0, grpcerr.WithReasonCode(codes.Unauthenticated, runtimev1.ReasonCode_AUTH_TOKEN_INVALID)
	}
	config, revisionText, found, err := s.aiConfigStore.Get(ctx, accountID, aiconfig.LocalAgentSubsystemOwner())
	if err != nil {
		return ctx, nil, executionintent.Intent{}, 0, appAIConfigPersistenceError(err)
	}
	if !found || config == nil {
		return ctx, nil, executionintent.Intent{}, 0, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_NOT_FOUND)
	}
	revision, err := strconv.ParseUint(revisionText, 10, 64)
	if err != nil || revision == 0 {
		return ctx, nil, executionintent.Intent{}, 0, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
	}
	for _, capability := range config.GetCapabilities() {
		if capability.GetCapabilityContract() != capabilitydriver.TextEmbedCapabilityContract {
			continue
		}
		intent, intentErr := executionintent.FromCapability(capability)
		if intentErr != nil {
			return ctx, nil, executionintent.Intent{}, 0, grpcerr.WrapWithReasonCode(
				codes.FailedPrecondition,
				runtimev1.ReasonCode_AI_CONFIG_INVALID,
				intentErr,
				grpcerr.ReasonOptions{Message: "shared LocalAgent text.embed AIConfig is incomplete"},
			)
		}
		appID := "nimi.runtime.memory"
		if principal, ok := protectedprincipal.FromContext(ctx); ok {
			appID = strings.TrimSpace(principal.AppID)
		}
		head := &runtimev1.ScenarioRequestHead{AppId: appID, SubjectUserId: accountID}
		return executionintent.WithIntent(ctx, intent), head, intent, revision, nil
	}
	return ctx, nil, executionintent.Intent{}, 0, grpcerr.WithReasonCodeOptions(
		codes.FailedPrecondition,
		runtimev1.ReasonCode_AI_CONFIG_INVALID,
		grpcerr.ReasonOptions{Message: "shared LocalAgent text.embed AIConfig is missing"},
	)
}

func memoryEmbeddingAccountID(ctx context.Context) string {
	if accountID := scenarioTargetSubjectUserID(ctx, nil); accountID != "" {
		return accountID
	}
	if accountID, ok := executionintent.RuntimeAccountSubjectFromContext(ctx); ok {
		return accountID
	}
	if principal, ok := protectedprincipal.FromContext(ctx); ok {
		return strings.TrimSpace(principal.AccountID)
	}
	return ""
}
