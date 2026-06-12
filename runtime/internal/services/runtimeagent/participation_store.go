package runtimeagent

import (
	"strings"
	"sync"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
)

// participationRecord is the Runtime-owned in-process record of one
// participation admission/execution. It mirrors the delegated/realm-group
// in-process state posture: typed records and request-id idempotency keyed in
// memory, while audit truth stays exclusively in the Runtime audit store
// (K-AGCORE-087: no participation-specific side audit store is admitted).
type participationRecord struct {
	ParticipationID  string
	RequestID        string
	ProfileKind      runtimev1.ParticipationProfileKind
	AgentID          string
	ParticipantRef   string
	TriggerRef       string
	IdentitySource   runtimev1.ParticipationIdentitySource
	ContextBlockRefs []string
	Status           runtimev1.ParticipationStatus
	RefusalReason    string
	Verdicts         *runtimev1.ParticipationVerdictSet
	PolicyVerdictRef string
	Candidate        *runtimev1.ParticipationCandidateRecord
	AuditID          string
	SensitivityClass string
	CreatedAt        time.Time
}

func cloneParticipationRecord(input *participationRecord) *participationRecord {
	if input == nil {
		return nil
	}
	cloned := *input
	cloned.ContextBlockRefs = append([]string(nil), input.ContextBlockRefs...)
	if input.Verdicts != nil {
		cloned.Verdicts = proto.Clone(input.Verdicts).(*runtimev1.ParticipationVerdictSet)
	}
	if input.Candidate != nil {
		cloned.Candidate = proto.Clone(input.Candidate).(*runtimev1.ParticipationCandidateRecord)
	}
	return &cloned
}

// participationStore is the in-process participation record store. Candidate
// content never lives here: candidate_ref points into the owning destination
// surface (K-AGCORE-082), and audit/replay lineage lives in the Runtime audit
// store only (K-AGCORE-087).
type participationStore struct {
	mu          sync.RWMutex
	records     map[string]*participationRecord
	byRequestID map[string]string
}

func newParticipationStore() *participationStore {
	return &participationStore{
		records:     make(map[string]*participationRecord),
		byRequestID: make(map[string]string),
	}
}

func (p *participationStore) get(participationID string) *participationRecord {
	if p == nil {
		return nil
	}
	p.mu.RLock()
	defer p.mu.RUnlock()
	return cloneParticipationRecord(p.records[strings.TrimSpace(participationID)])
}

func (p *participationStore) getByRequestID(requestID string) *participationRecord {
	if p == nil {
		return nil
	}
	p.mu.RLock()
	defer p.mu.RUnlock()
	participationID := p.byRequestID[strings.TrimSpace(requestID)]
	if participationID == "" {
		return nil
	}
	return cloneParticipationRecord(p.records[participationID])
}

// putIfAbsentByRequestID stores record keyed by its request id unless another
// execution already won the race for the same request id. The returned record
// is the authoritative one for that request id; replays of the same
// request_id must never create a second execution.
func (p *participationStore) putIfAbsentByRequestID(record *participationRecord) *participationRecord {
	if p == nil || record == nil {
		return nil
	}
	requestID := strings.TrimSpace(record.RequestID)
	participationID := strings.TrimSpace(record.ParticipationID)
	p.mu.Lock()
	defer p.mu.Unlock()
	if existingID := p.byRequestID[requestID]; existingID != "" {
		return cloneParticipationRecord(p.records[existingID])
	}
	p.records[participationID] = cloneParticipationRecord(record)
	p.byRequestID[requestID] = participationID
	return cloneParticipationRecord(record)
}

// participationStore returns the Service-owned store, initializing it lazily
// so both New()-constructed services and zero-value test services share the
// same constructor-injected state shape (no package-global mutable state).
func (s *Service) participationStore() *participationStore {
	s.participationOnce.Do(func() {
		s.participationState = newParticipationStore()
	})
	return s.participationState
}
