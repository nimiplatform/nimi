package localservice

import (
	"context"
	"errors"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"google.golang.org/grpc/metadata"
	"google.golang.org/protobuf/proto"
)

const modelInstallPlanTTL = 10 * time.Minute

var (
	errModelInstallPlanMissing = errors.New("install plan id is required")
	errModelInstallPlanUnknown = errors.New("install plan is unknown or already consumed")
	errModelInstallPlanExpired = errors.New("install plan expired")
	errModelInstallPlanOwner   = errors.New("install plan belongs to another owner")
)

type heldModelInstallPlan struct {
	plan      *runtimev1.LocalInstallPlanDescriptor
	ownerKey  string
	expiresAt time.Time
}

func (s *Service) holdModelInstallPlan(ctx context.Context, plan *runtimev1.LocalInstallPlanDescriptor) {
	if s == nil || plan == nil || strings.TrimSpace(plan.GetPlanId()) == "" {
		return
	}
	now := s.modelInstallPlanTime()
	s.mu.Lock()
	if s.heldModelInstallPlans == nil {
		s.heldModelInstallPlans = make(map[string]heldModelInstallPlan)
	}
	pruneExpiredModelInstallPlansLocked(s.heldModelInstallPlans, now)
	s.heldModelInstallPlans[strings.TrimSpace(plan.GetPlanId())] = heldModelInstallPlan{
		plan:      proto.Clone(plan).(*runtimev1.LocalInstallPlanDescriptor),
		ownerKey:  modelInstallPlanOwnerKey(ctx),
		expiresAt: now.Add(modelInstallPlanTTL),
	}
	s.mu.Unlock()
}

func (s *Service) takeModelInstallPlan(ctx context.Context, planIDRaw string) (*runtimev1.LocalInstallPlanDescriptor, error) {
	planID := strings.TrimSpace(planIDRaw)
	if planID == "" {
		return nil, errModelInstallPlanMissing
	}
	now := s.modelInstallPlanTime()
	ownerKey := modelInstallPlanOwnerKey(ctx)
	s.mu.Lock()
	defer s.mu.Unlock()
	held, exists := s.heldModelInstallPlans[planID]
	if !exists {
		return nil, errModelInstallPlanUnknown
	}
	if !held.expiresAt.After(now) {
		delete(s.heldModelInstallPlans, planID)
		return nil, errModelInstallPlanExpired
	}
	if held.ownerKey != ownerKey {
		return nil, errModelInstallPlanOwner
	}
	delete(s.heldModelInstallPlans, planID)
	return proto.Clone(held.plan).(*runtimev1.LocalInstallPlanDescriptor), nil
}

func (s *Service) modelInstallPlanTime() time.Time {
	if s != nil && s.modelInstallPlanNow != nil {
		return s.modelInstallPlanNow().UTC()
	}
	return time.Now().UTC()
}

func pruneExpiredModelInstallPlansLocked(plans map[string]heldModelInstallPlan, now time.Time) {
	for planID, held := range plans {
		if !held.expiresAt.After(now) {
			delete(plans, planID)
		}
	}
}

func modelInstallPlanOwnerKey(ctx context.Context) string {
	parts := make([]string, 0, 5)
	if identity := authn.IdentityFromContext(ctx); identity != nil {
		parts = append(parts, strings.TrimSpace(identity.SubjectUserID), strings.TrimSpace(identity.SessionID))
	}
	if incoming, ok := metadata.FromIncomingContext(ctx); ok {
		for _, key := range []string{"x-nimi-app-id", "x-nimi-app-instance-id", "x-nimi-caller-id"} {
			values := incoming.Get(key)
			if len(values) == 1 {
				parts = append(parts, strings.TrimSpace(values[0]))
			}
		}
	}
	ownerKey := strings.Join(parts, "\x00")
	if strings.Trim(ownerKey, "\x00") == "" {
		return "runtime-local-owner"
	}
	return ownerKey
}
