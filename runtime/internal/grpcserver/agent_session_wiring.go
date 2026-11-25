package grpcserver

import (
	"context"
	"database/sql"
	"errors"
	"hash/fnv"
	"log/slog"
	"path/filepath"
	"strings"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/memoryv1"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
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
	kernel *localappkernel.Kernel,
) (*agentsession.Service, error) {
	sessionsDBPath := ""
	requirePersistent := false
	if strings.TrimSpace(cfg.LocalStatePath) != "" {
		sessionsDBPath = filepath.Join(filepath.Dir(cfg.LocalStatePath), "sessions.db")
		requirePersistent = true
	}

	var (
		milestoneHook agentsession.MilestoneHook = func(context.Context, string, string, string, string, string, string, []string) error {
			return errors.New("session milestone awaiting Cognition owner")
		}
		memoryCleanupHook agentsession.MemoryCleanupHook = func(context.Context, string, string, string) (uint32, error) {
			return 0, errors.New("session memory cleanup awaiting Cognition owner")
		}
		readSetQualifier agentsession.ReadSetQualifier = func(context.Context, string, string, string, int64) (bool, int64, error) {
			return false, 0, errors.New("session memory qualification awaiting Cognition owner")
		}
	)
	if memoryFacade != nil {
		facadeRef := memoryFacade
		milestoneHook = func(ctx context.Context, _ string, agentBinding, workSessionRef, bodyKind, milestoneKind, topicSummary string, _ []string) error {
			effectiveBodyKind := strings.TrimSpace(bodyKind)
			if effectiveBodyKind == "" {
				effectiveBodyKind = agentsession.DefaultPCNamespace
			}
			_, err := facadeRef.CommitSessionPointer(ctx, agentBinding, workSessionRef, milestoneKind, topicSummary, effectiveBodyKind, time.Now().UTC())
			return err
		}
		memoryCleanupHook = func(ctx context.Context, _ string, agentBinding, workSessionRef string) (uint32, error) {
			forgotten, _, err := facadeRef.ForgetSessionLineage(ctx, agentBinding, workSessionRef)
			return forgotten, err
		}
		readSetQualifier = func(ctx context.Context, _, agentBinding, _ string, lastEpoch int64) (bool, int64, error) {
			proj, err := facadeRef.InspectBinding(ctx, agentBinding)
			if err != nil {
				// Only an explicitly absent Cognition memory binding (unconfigured agent)
				// may proceed with epoch 0; any storage/owner failure MUST fail closed!
				if errors.Is(err, sql.ErrNoRows) && lastEpoch == 0 {
					return true, 0, nil
				}
				return false, lastEpoch, err
			}
			if proj.Outcome == memoryv1.OutcomeUnconfigured || !proj.Enabled || proj.AdoptionRequired {
				if lastEpoch > 0 {
					return false, 0, nil
				}
				return true, 0, nil
			}
			// Derive read-set epoch strictly from lifecycle_ref (delete-all/disable cutoff)
			// and ForgottenCount; NEVER include SupersededCount so ordinary milestone pointer
			// updates do not invalidate active Body sessions.
			h := fnv.New64a()
			_, _ = h.Write([]byte(strings.TrimSpace(proj.LifecycleRef)))
			lifecycleTag := int64(h.Sum64() & 0x0000_0000_7fff_ffff)
			currentEpoch := (lifecycleTag << 24) | int64(proj.ForgottenCount&0x00ff_ffff)
			if currentEpoch <= 0 {
				currentEpoch = 1
			}
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
				CallerAppID:         in.CallerAppID,
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
		brainTurnExecutor = func(ctx context.Context, in agentsession.BrainTurnExecutionInput, emit func(eventType, payloadJSON string, persist bool) error) error {
			offlineRecall := ""
			if memoryFacade != nil && svcRef != nil && in.Session != nil &&
				in.Session.GetTrustTier() == "trusted" &&
				in.Session.GetSessionKind() == "general_inbox" &&
				strings.TrimSpace(in.UserText) != "" {
				recallRes, recallErr := memoryFacade.Recall(ctx, cognitionmemory.RecallIntent{
					NoModelWork:   true,
					LocalAgentRef: in.Session.GetAgentBinding(),
					Query:         in.UserText,
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
						// Always authorize recall strictly against the real caller decision!
						if frame, _, err := svcRef.BuildOfflineSessionRecallInjection(ctx, in.CallerDecision, in.Session.GetAgentBinding(), ptrs); err == nil {
							offlineRecall = frame
						}
					}
				}
			}
			return agentRef.ExecuteBrainInlineTurn(
				ctx,
				runtimeagentservice.BrainInlineTurnRuntimeInput{
					AccountID:            in.AccountID,
					CallerAppID:          in.CallerDecision.AppID,
					LocalAgentRef:        in.Session.GetAgentBinding(),
					WorkSessionRef:       in.Session.GetWorkSessionRef(),
					SessionKind:          in.Session.GetSessionKind(),
					TrustTier:            in.Session.GetTrustTier(),
					UserText:             in.UserText,
					RequestID:            in.RequestID,
					OfflineRecallContext: offlineRecall,
					History:              in.History,
				},
				emit,
			)
		}
		alarmLLMRunner = func(ctx context.Context, accountID string, alarm *runtimev1.SessionAlarmRecord, reserve func(int64) error) (string, string, int64, error) {
			return agentRef.RunAlarmLLM(
				ctx,
				accountID,
				alarm.GetAgentBinding(),
				alarm.GetTemplateTitle(),
				alarm.GetTemplateBody(),
				alarm.GetTargetWorkSessionRef(), reserve,
			)
		}
	}

	isDesktopDeliveryChannel := func(channel string) bool {
		switch strings.ToLower(strings.TrimSpace(channel)) {
		case "desktop_notification", "desktop", "home", "local":
			return true
		default:
			return false
		}
	}

	alarmDeliverySender := func(ctx context.Context, accountID string, alarm *runtimev1.SessionAlarmRecord, channel, renderedTitle, renderedBody string, _ time.Duration) agentsession.AlarmDeliveryOutcome {
		norm := strings.ToLower(strings.TrimSpace(channel))
		if isDesktopDeliveryChannel(norm) {
			return svcRef.NotifyDesktopAlarm(alarm, renderedTitle, renderedBody)
		}
		// Never fabricate pseudo-success for external/IM channels when no connected provider exists.
		return agentsession.AlarmDeliveryOutcome{
			ReceiptState: runtimev1.AlarmDeliveryReceiptState_ALARM_DELIVERY_RECEIPT_STATE_REJECTED,
			Detail:       "no connected delivery provider for channel " + norm,
		}
	}

	var agentTerminatedChecker func(accountID, agentBinding string) bool
	if agentSvc != nil {
		agentRef := agentSvc
		agentTerminatedChecker = agentRef.IsAgentTerminated
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
		BodyNamespaceOwner: func(ctx context.Context, ns string) (string, error) {
			if kernel == nil {
				return "", errors.New("registration authority unavailable")
			}
			return kernel.Registrations().BodyNamespaceOwner(ctx, ns)
		},
		AlarmDeliverySender:      alarmDeliverySender,
		SupportedDeliveryChannel: isDesktopDeliveryChannel,
		AlarmLLMRunner:           alarmLLMRunner,
		AgentTerminatedChecker:   agentTerminatedChecker,
	})
	if err != nil {
		return nil, err
	}
	svcRef = svc

	if agentSvc != nil {
		agentSvc.SetAgentTerminatedHook(func(ctx context.Context, accountID, localAgentRef string) {
			if err := svc.EnqueueAndPurgeAgent(ctx, accountID, localAgentRef); err != nil && logger != nil {
				logger.Warn("purge agent sessions on agent termination failed (queued for retry)", "agent", localAgentRef, "error", err)
			}
		})
	}
	// Run immediate startup reconciliation for any sessions stuck in 'deleting'
	// or any agents terminated before SetAgentTerminatedHook was registered.
	_ = svc.RecoverPendingDeletions(context.Background())
	_ = svc.RecoverPendingAgentPurges(context.Background())
	svc.StartAlarmTicker(context.Background(), 15*time.Second)
	return svc, nil
}
