package runtimeagent

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

const (
	runtimeAgentMetaDelegatedControlVersionKey = "delegated_control_state_version"
	runtimeAgentMetaDelegatedControlStateKey   = "delegated_control_state"
)

type persistedDelegatedControlState struct {
	Version          uint64                           `json:"version"`
	SavedAt          string                           `json:"savedAt"`
	ProviderProfiles []persistedDelegatedProtoRecord  `json:"providerProfiles"`
	ApprovalRequests []persistedDelegatedProtoRecord  `json:"approvalRequests"`
	PausedRequests   []persistedDelegatedPausedRecord `json:"pausedRequests"`
}

type persistedDelegatedProtoRecord struct {
	Key   string          `json:"key"`
	Value json.RawMessage `json:"value"`
}

type persistedDelegatedPausedRecord struct {
	Key   string                                       `json:"key"`
	Value runtimeAgentPausedDelegatedCapabilityRequest `json:"value"`
}

func (s *Service) persistDelegatedControlStateLocked() error {
	if s == nil || s.backend == nil {
		return nil
	}
	snapshot, err := s.captureDelegatedControlStateLocked()
	if err != nil {
		return err
	}
	return s.persistDelegatedControlStateSnapshot(snapshot)
}

func (s *Service) captureDelegatedControlStateLocked() (persistedDelegatedControlState, error) {
	s.ensureDelegatedControlStoresLocked()
	snapshot := persistedDelegatedControlState{
		Version:          uint64(time.Now().UTC().UnixNano()),
		SavedAt:          time.Now().UTC().Format(time.RFC3339Nano),
		ProviderProfiles: make([]persistedDelegatedProtoRecord, 0, len(s.delegatedProviderProfiles)),
		ApprovalRequests: make([]persistedDelegatedProtoRecord, 0, len(s.delegatedApprovalRequests)),
		PausedRequests:   make([]persistedDelegatedPausedRecord, 0, len(s.delegatedPausedRequests)),
	}
	marshal := protojson.MarshalOptions{UseProtoNames: true}
	for _, key := range sortedDelegatedKeys(s.delegatedProviderProfiles) {
		raw, err := marshal.Marshal(s.delegatedProviderProfiles[key])
		if err != nil {
			return persistedDelegatedControlState{}, fmt.Errorf("marshal delegated provider profile %s: %w", key, err)
		}
		snapshot.ProviderProfiles = append(snapshot.ProviderProfiles, persistedDelegatedProtoRecord{
			Key:   key,
			Value: append(json.RawMessage(nil), raw...),
		})
	}
	for _, key := range sortedDelegatedKeys(s.delegatedApprovalRequests) {
		raw, err := marshal.Marshal(s.delegatedApprovalRequests[key])
		if err != nil {
			return persistedDelegatedControlState{}, fmt.Errorf("marshal delegated approval request %s: %w", key, err)
		}
		snapshot.ApprovalRequests = append(snapshot.ApprovalRequests, persistedDelegatedProtoRecord{
			Key:   key,
			Value: append(json.RawMessage(nil), raw...),
		})
	}
	pausedKeys := make([]string, 0, len(s.delegatedPausedRequests))
	for key := range s.delegatedPausedRequests {
		pausedKeys = append(pausedKeys, key)
	}
	sort.Strings(pausedKeys)
	for _, key := range pausedKeys {
		paused := cloneRuntimeAgentPausedDelegatedCapabilityRequest(s.delegatedPausedRequests[key])
		if paused == nil {
			continue
		}
		snapshot.PausedRequests = append(snapshot.PausedRequests, persistedDelegatedPausedRecord{
			Key:   key,
			Value: *paused,
		})
	}
	return snapshot, nil
}

func sortedDelegatedKeys[T any](items map[string]T) []string {
	keys := make([]string, 0, len(items))
	for key := range items {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func (s *Service) persistDelegatedControlStateSnapshot(snapshot persistedDelegatedControlState) error {
	if s == nil || s.backend == nil {
		return nil
	}
	raw, err := json.Marshal(snapshot)
	if err != nil {
		return fmt.Errorf("marshal delegated control state: %w", err)
	}
	return s.backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		if _, err := tx.Exec(
			`INSERT INTO runtime_local_agent_meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
			runtimeAgentMetaDelegatedControlVersionKey,
			encodeSequenceValue(snapshot.Version),
		); err != nil {
			return err
		}
		_, err := tx.Exec(
			`INSERT INTO runtime_local_agent_meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
			runtimeAgentMetaDelegatedControlStateKey,
			string(raw),
		)
		return err
	})
}

func (s *Service) loadDelegatedControlStateFromDB() error {
	if s == nil || s.stateRepo == nil {
		return nil
	}
	raw, err := s.stateRepo.runtimeAgentMetaValue(runtimeAgentMetaDelegatedControlStateKey)
	if err != nil {
		return err
	}
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	var persisted persistedDelegatedControlState
	if err := json.Unmarshal([]byte(raw), &persisted); err != nil {
		return fmt.Errorf("parse delegated control state: %w", err)
	}
	unmarshal := protojson.UnmarshalOptions{DiscardUnknown: false}
	profiles := map[string]*runtimev1.DelegatedProviderProfile{}
	for _, item := range persisted.ProviderProfiles {
		key := strings.TrimSpace(item.Key)
		profile := &runtimev1.DelegatedProviderProfile{}
		if err := unmarshal.Unmarshal(item.Value, profile); err != nil {
			return fmt.Errorf("parse delegated provider profile %s: %w", key, err)
		}
		if strings.TrimSpace(key) == ":" || strings.TrimSpace(profile.GetProviderProfileId()) == "" {
			return fmt.Errorf("persisted delegated provider profile has invalid key")
		}
		profiles[key] = proto.Clone(profile).(*runtimev1.DelegatedProviderProfile)
	}
	approvals := map[string]*runtimev1.DelegatedApprovalRequest{}
	for _, item := range persisted.ApprovalRequests {
		key := strings.TrimSpace(item.Key)
		approval := &runtimev1.DelegatedApprovalRequest{}
		if err := unmarshal.Unmarshal(item.Value, approval); err != nil {
			return fmt.Errorf("parse delegated approval request %s: %w", key, err)
		}
		if key == "" {
			key = delegatedApprovalRequestKey(approval.GetAgentId(), approval.GetApprovalRequestId())
		}
		if strings.TrimSpace(key) == ":" || strings.TrimSpace(approval.GetApprovalRequestId()) == "" {
			return fmt.Errorf("persisted delegated approval request has invalid key")
		}
		approvals[key] = proto.Clone(approval).(*runtimev1.DelegatedApprovalRequest)
	}
	pausedRequests := map[string]*runtimeAgentPausedDelegatedCapabilityRequest{}
	for _, item := range persisted.PausedRequests {
		key := strings.TrimSpace(item.Key)
		paused := cloneRuntimeAgentPausedDelegatedCapabilityRequest(&item.Value)
		if paused == nil {
			continue
		}
		if key == "" {
			key = delegatedApprovalRequestKey(paused.AgentID, paused.ApprovalRequestID)
		}
		if strings.TrimSpace(key) == ":" || strings.TrimSpace(paused.ApprovalRequestID) == "" {
			return fmt.Errorf("persisted delegated paused request has invalid key")
		}
		if approvals[key] == nil {
			return fmt.Errorf("persisted delegated paused request %s has no approval request", key)
		}
		paused.ResumeState = firstNonEmpty(strings.TrimSpace(paused.ResumeState), delegatedResumeStatePending)
		paused.Mode = firstNonEmpty(strings.TrimSpace(paused.Mode), delegatedPausedModePreinvoke)
		pausedRequests[key] = paused
	}
	s.delegatedMu.Lock()
	defer s.delegatedMu.Unlock()
	s.delegatedProviderProfiles = profiles
	s.delegatedApprovalRequests = approvals
	s.delegatedPausedRequests = pausedRequests
	return nil
}
