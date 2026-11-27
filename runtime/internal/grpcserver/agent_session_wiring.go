package grpcserver

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
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
	svc, err := openProductionAgentSessionService(cfg, logger, aiSvc, agentSvc, memoryFacade, kernel)
	if err != nil {
		return nil, err
	}
	startProductionAgentSessionBackgroundWork(svc)
	return svc, nil
}

func openProductionAgentSessionService(
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
		milestoneHook agentsession.MilestoneHook = func(context.Context, agentsession.SessionMilestone) error {
			return errors.New("session milestone awaiting Cognition owner")
		}
		memoryCleanupHook agentsession.MemoryCleanupHook = func(context.Context, string, string, string) (uint32, error) {
			return 0, errors.New("session memory cleanup awaiting Cognition owner")
		}
		readSetQualifier agentsession.ReadSetQualifier = func(context.Context, string, string, string, int64) (bool, int64, error) {
			return false, 0, errors.New("session memory qualification awaiting Cognition owner")
		}
	)
	var qualifyMemory agentsession.MemoryQualifier
	if memoryFacade != nil {
		qualifyMemory = memoryFacade.QualifyReadSet
		facadeRef := memoryFacade
		milestoneHook = func(ctx context.Context, milestone agentsession.SessionMilestone) error {
			effectiveBodyKind := strings.TrimSpace(milestone.BodyKind)
			if effectiveBodyKind == "" {
				effectiveBodyKind = agentsession.DefaultPCNamespace
			}
			_, err := facadeRef.CommitSessionPointer(ctx, milestone.DeliveryID, milestone.AgentBinding, milestone.WorkSessionRef, milestone.Kind, milestone.TopicSummary, effectiveBodyKind, time.Now().UTC())
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
				MemoryReadSet:       res.MemoryReadSet,
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
				// Authorize eligible non-restricted sessions BEFORE Cognition matches or ranks
				// pointers so hidden brief content in legacy pointers never affects hits,
				// ordering, or result limits.
				eligibleSlots, slotErr := svcRef.EligibleOfflineRecallSlotKeys(ctx, in.CallerDecision, in.Session.GetAgentBinding())
				if slotErr == nil && len(eligibleSlots) > 0 {
					recallRes, recallErr := memoryFacade.Recall(ctx, cognitionmemory.RecallIntent{
						NoModelWork:     true,
						LocalAgentRef:   in.Session.GetAgentBinding(),
						Query:           in.UserText,
						Limit:           4,
						ScopeTags:       []string{memoryv1.ScopeTagSessionPointer},
						FilterSlotKeys:  true,
						AllowedSlotKeys: eligibleSlots,
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
		QualifyMemory:       qualifyMemory,
		MilestoneHook:       milestoneHook,
		MemoryCleanupHook:   memoryCleanupHook,
		BrainTurnExecutor:   brainTurnExecutor,
		BodyNamespaceOwner: func(ctx context.Context, ns string) (string, error) {
			if kernel == nil {
				return "", errors.New("registration authority unavailable")
			}
			return kernel.Registrations().BodyNamespaceOwner(ctx, ns)
		},
		NamedRecipientResolver: func(ctx context.Context, accountID, appID string) (string, error) {
			if kernel == nil || strings.TrimSpace(accountID) == "" || strings.TrimSpace(appID) == "" {
				return "", agentsession.ErrNamedRecipientUnavailable
			}
			statuses, err := kernel.Registrations().ListStatuses(ctx)
			if err != nil {
				return "", err
			}
			var matched []string
			for _, st := range statuses {
				if !st.Available || st.State != localappkernel.RegistrationStateActive || st.SourceClass == localappkernel.SourceClassRemote {
					continue
				}
				if st.AppID != appID {
					continue
				}
				reg, err := kernel.Registrations().GetBySubject(ctx, st.RegisteredAppSubject)
				if err != nil || reg.State != localappkernel.RegistrationStateActive {
					continue
				}
				hasBodyPC := false
				for _, domain := range reg.ActivatedDomains {
					if domain == agentsession.DomainAgentBodyPC {
						hasBodyPC = true
						break
					}
				}
				if !hasBodyPC {
					continue
				}
				matched = append(matched, reg.RegisteredAppSubject)
			}
			if len(matched) == 0 {
				return "", agentsession.ErrNamedRecipientUnavailable
			}
			if len(matched) > 1 {
				return "", agentsession.ErrNamedRecipientAmbiguous
			}
			return matched[0], nil
		},
		NamedRecipientVerifier: func(ctx context.Context, accountID, subject, appID string) (bool, error) {
			if kernel == nil || strings.TrimSpace(accountID) == "" || strings.TrimSpace(subject) == "" {
				return false, nil
			}
			reg, err := kernel.Registrations().GetBySubject(ctx, subject)
			if err != nil {
				if errors.Is(err, localappkernel.ErrNotFound) || errors.Is(err, localappkernel.ErrRegistrationUnavailable) || errors.Is(err, localappkernel.ErrRegistrationTombstoned) {
					return false, nil
				}
				return false, err
			}
			if reg.State != localappkernel.RegistrationStateActive || reg.SourceClass == localappkernel.SourceClassRemote {
				return false, nil
			}
			if appID != "" && reg.AppID != appID {
				return false, nil
			}
			st, err := kernel.Registrations().Status(ctx, reg.RegistrationHandle)
			if err != nil || !st.Available {
				return false, nil
			}
			for _, domain := range reg.ActivatedDomains {
				if domain == agentsession.DomainAgentBodyPC {
					return true, nil
				}
			}
			return false, nil
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

	if memoryFacade != nil {
		// Install fail-closed restricted-session fencing before any outbox replay
		// or publication can deliver legacy content-bearing named handoff payloads
		// into general Cognition Memory or indexes.
		memoryFacade.SetSessionRestrictionChecker(svc.IsSessionContentRestricted)
		restrictedSessions, listErr := svc.ListRestrictedSessions(context.Background())
		if listErr != nil {
			_ = svc.Close()
			return nil, fmt.Errorf("list restricted sessions for Cognition Memory fencing: %w", listErr)
		}
		for _, item := range restrictedSessions {
			if _, fenceErr := memoryFacade.FenceRestrictedSessionLegacyReplay(context.Background(), item.AgentBinding, item.WorkSessionRef); fenceErr != nil {
				_ = svc.Close()
				return nil, fmt.Errorf("fence legacy Cognition Memory replay for restricted session %s: %w", item.WorkSessionRef, fenceErr)
			}
		}
	}

	if agentSvc != nil {
		agentSvc.SetAgentTerminatedHook(func(ctx context.Context, accountID, localAgentRef string) {
			if err := svc.EnqueueAndPurgeAgent(ctx, accountID, localAgentRef); err != nil && logger != nil {
				logger.Warn("purge agent sessions on agent termination failed (queued for retry)", "agent", localAgentRef, "error", err)
			}
		})
	}
	return svc, nil
}

func startProductionAgentSessionBackgroundWork(svc *agentsession.Service) {
	if svc == nil {
		return
	}
	// Run immediate startup reconciliation for any sessions stuck in 'deleting'
	// or any agents terminated before SetAgentTerminatedHook was registered.
	_ = svc.RecoverPendingDeletions(context.Background())
	_ = svc.RecoverPendingAgentPurges(context.Background())
	svc.StartAlarmTicker(context.Background(), 15*time.Second)
}
