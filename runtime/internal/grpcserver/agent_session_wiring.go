package grpcserver

import (
	"context"
	"log/slog"
	"path/filepath"
	"strings"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/memoryv1"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/protocol/envelope"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"github.com/nimiplatform/nimi/runtime/internal/services/agentsession"
	aiservice "github.com/nimiplatform/nimi/runtime/internal/services/ai"
	"github.com/nimiplatform/nimi/runtime/internal/services/cognitionmemory"
	runtimeagentservice "github.com/nimiplatform/nimi/runtime/internal/services/runtimeagent"
)

func buildProductionAgentSessionService(
	cfg config.Config,
	logger *slog.Logger,
	aiSvc *aiservice.Service,
	agentSvc *runtimeagentservice.Service,
	memoryFacade *cognitionmemory.Facade,
) (*agentsession.Service, error) {
	sessionsDBPath := ""
	requirePersistent := false
	if strings.TrimSpace(cfg.LocalStatePath) != "" {
		sessionsDBPath = filepath.Join(filepath.Dir(cfg.LocalStatePath), "sessions.db")
		requirePersistent = true
	}

	var (
		milestoneHook     agentsession.MilestoneHook
		memoryCleanupHook agentsession.MemoryCleanupHook
		readSetQualifier  agentsession.ReadSetQualifier
	)
	if memoryFacade != nil {
		facadeRef := memoryFacade
		milestoneHook = func(ctx context.Context, _ string, agentBinding, workSessionRef, milestoneKind, topicSummary string, _ []string) error {
			_, err := facadeRef.CommitSessionPointer(ctx, agentBinding, workSessionRef, milestoneKind, topicSummary, agentsession.DefaultPCNamespace, time.Now().UTC())
			return err
		}
		memoryCleanupHook = func(ctx context.Context, _ string, agentBinding, workSessionRef string) (uint32, error) {
			forgotten, _, err := facadeRef.ForgetSessionLineage(ctx, agentBinding, workSessionRef)
			return forgotten, err
		}
		readSetQualifier = func(ctx context.Context, _, agentBinding, _ string, lastEpoch int64) (bool, int64, error) {
			proj, err := facadeRef.InspectBinding(ctx, agentBinding)
			if err != nil {
				// Fail closed if Cognition memory owner is unreachable while a read set is tracked.
				if lastEpoch > 0 {
					return false, lastEpoch, err
				}
				return true, 0, nil
			}
			if proj.Outcome == memoryv1.OutcomeUnconfigured || !proj.Enabled || proj.AdoptionRequired {
				if lastEpoch > 0 {
					return false, 0, nil
				}
				return true, 0, nil
			}
			// Monotonic mutation epoch: increments on every forget or supersede mutation.
			currentEpoch := int64(proj.ForgottenCount)*1_000_000 + int64(proj.SupersededCount) + 1
			if lastEpoch > 0 && currentEpoch != lastEpoch {
				return false, currentEpoch, nil
			}
			return true, currentEpoch, nil
		}
	}

	var svcRef *agentsession.Service
	var (
		endpointResolver    func(string) string
		agentHandleResolver agentsession.AgentHandleResolver
		bodyStepExecutor    agentsession.BodyStepExecutor
		brainTurnExecutor   agentsession.BrainTurnExecutor
		alarmLLMRunner      agentsession.AlarmLLMRunner
	)
	if agentSvc != nil {
		agentRef := agentSvc
		endpointResolver = agentRef.ResolveAgentEndpointKey
		agentHandleResolver = agentRef.ResolveAgentSessionBinding
		bodyStepExecutor = func(ctx context.Context, in agentsession.BodyStepExecutionInput, emitter agentsession.BodyStepEmitter) (agentsession.BodyStepExecutionResult, error) {
			res, err := agentRef.ExecuteAgentBodyStep(ctx, runtimeagentservice.BodyStepRuntimeInput{
				AccountID:           in.AccountID,
				AgentBinding:        in.AgentBinding,
				WorkSessionRef:      in.WorkSessionRef,
				Purpose:             in.Purpose,
				AdvisoryNonceBlock:  in.AdvisoryNonceBlock,
				Tools:               in.Tools,
				CanonicalMessages:   in.CanonicalMessages,
				ContextBudgetTokens: in.ContextBudgetTokens,
			}, runtimeagentservice.BodyStepRuntimeCallbacks{
				SendTextDelta:             emitter.SendTextDelta,
				SendReasoningSummaryDelta: emitter.SendReasoningSummaryDelta,
				SendToolCallActivity:      emitter.SendToolCallActivity,
				SendToolCall:              emitter.SendToolCall,
			})
			if err != nil {
				return agentsession.BodyStepExecutionResult{}, err
			}
			return agentsession.BodyStepExecutionResult{
				FinishReason:        res.FinishReason,
				UsageInputTokens:    res.UsageInputTokens,
				UsageOutputTokens:   res.UsageOutputTokens,
				AssistantText:       res.AssistantText,
				CompactionSummary:   res.CompactionSummary,
				IssuedToolCalls:     res.IssuedToolCalls,
				ContextBudgetTokens: res.ContextBudgetTokens,
			}, nil
		}
		brainTurnExecutor = func(ctx context.Context, accountID string, session *runtimev1.WorkSessionRecord, userText, requestID string, emit func(eventType, payloadJSON string) error) error {
			offlineRecall := ""
			if memoryFacade != nil && svcRef != nil && session != nil && session.GetSessionKind() == "general_inbox" && strings.TrimSpace(userText) != "" {
				recallRes, recallErr := memoryFacade.Recall(ctx, cognitionmemory.RecallIntent{
					NoModelWork:   true,
					LocalAgentRef: session.GetAgentBinding(),
					Query:         userText,
					Limit:         4,
					ScopeTags:     []string{memoryv1.ScopeTagSessionPointer},
				})
				if recallErr == nil && len(recallRes.Hits) > 0 {
					ptrs := make([]agentsession.OfflineRecallPointer, 0, len(recallRes.Hits))
					for i, hit := range recallRes.Hits {
						ref := strings.TrimPrefix(strings.TrimSpace(hit.SlotKey), "session_ref:")
						if ref == "" || ref == hit.SlotKey {
							continue
						}
						ptrs = append(ptrs, agentsession.OfflineRecallPointer{
							WorkSessionRef: ref,
							TopicSummary:   hit.Content,
							Score:          float64(len(recallRes.Hits) - i),
						})
					}
					if len(ptrs) > 0 {
						readerDecision := accountservice.LocalAppCallerDecision{
							AccountID:  accountID,
							AppID:      envelope.ProtectedDesktopAppID,
							TrustClass: accountservice.LocalAppTrustClassBuiltIn,
						}
						if frame, _, err := svcRef.BuildOfflineSessionRecallInjection(ctx, readerDecision, session.GetAgentBinding(), ptrs); err == nil {
							offlineRecall = frame
						}
					}
				}
			}
			return agentRef.ExecuteBrainInlineTurn(
				ctx,
				accountID,
				session.GetAgentBinding(),
				session.GetWorkSessionRef(),
				session.GetSessionKind(),
				userText,
				requestID,
				offlineRecall,
				emit,
			)
		}
		alarmLLMRunner = func(ctx context.Context, accountID string, alarm *runtimev1.SessionAlarmRecord) (string, string, int64, error) {
			return agentRef.RunAlarmLLM(
				ctx,
				accountID,
				alarm.GetAgentBinding(),
				alarm.GetTemplateTitle(),
				alarm.GetTemplateBody(),
				alarm.GetTargetWorkSessionRef(),
			)
		}
	}

	alarmDeliverySender := func(ctx context.Context, accountID string, alarm *runtimev1.SessionAlarmRecord, channel, renderedTitle, renderedBody string, _ time.Duration) agentsession.AlarmDeliveryOutcome {
		norm := strings.ToLower(strings.TrimSpace(channel))
		if norm == "desktop" || norm == "home" || norm == "local" {
			if svcRef == nil {
				return agentsession.AlarmDeliveryOutcome{
					ReceiptState: runtimev1.AlarmDeliveryReceiptState_ALARM_DELIVERY_RECEIPT_STATE_REJECTED,
					Detail:       "agent session owner unavailable",
				}
			}
			msgRef, err := svcRef.NotifyDesktopAlarm(ctx, accountID, alarm, renderedTitle, renderedBody)
			if err != nil {
				return agentsession.AlarmDeliveryOutcome{
					ReceiptState: runtimev1.AlarmDeliveryReceiptState_ALARM_DELIVERY_RECEIPT_STATE_REJECTED,
					Detail:       err.Error(),
				}
			}
			return agentsession.AlarmDeliveryOutcome{
				ReceiptState:       runtimev1.AlarmDeliveryReceiptState_ALARM_DELIVERY_RECEIPT_STATE_PROVIDER_ACCEPTED,
				ProviderMessageRef: msgRef,
				Detail:             "delivered to desktop overview attention stream",
			}
		}
		// Never fabricate pseudo-success for external/IM channels when no connected provider exists.
		return agentsession.AlarmDeliveryOutcome{
			ReceiptState: runtimev1.AlarmDeliveryReceiptState_ALARM_DELIVERY_RECEIPT_STATE_REJECTED,
			Detail:       "no connected delivery provider for channel " + norm,
		}
	}

	svc, err := agentsession.Open(agentsession.Options{
		Logger:              logger,
		DBPath:              sessionsDBPath,
		RequirePersistentDB: requirePersistent,
		Scheduler:           aiSvc.Scheduler(),
		EndpointResolver:    endpointResolver,
		AgentHandleResolver: agentHandleResolver,
		BodyStepExecutor:    bodyStepExecutor,
		ReadSetQualifier:    readSetQualifier,
		MilestoneHook:       milestoneHook,
		MemoryCleanupHook:   memoryCleanupHook,
		BrainTurnExecutor:   brainTurnExecutor,
		AlarmDeliverySender: alarmDeliverySender,
		AlarmLLMRunner:      alarmLLMRunner,
	})
	if err != nil {
		return nil, err
	}
	svcRef = svc

	if agentSvc != nil {
		agentSvc.SetAgentTerminatedHook(func(ctx context.Context, accountID, localAgentRef string) {
			if err := svc.PurgeAgent(ctx, accountID, localAgentRef); err != nil && logger != nil {
				logger.Warn("purge agent sessions on agent termination failed", "agent", localAgentRef, "error", err)
			}
		})
	}
	svc.StartAlarmTicker(context.Background(), 15*time.Second)
	return svc, nil
}
