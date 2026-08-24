package appregistry

import (
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"
)

var ErrEmptyAppID = errors.New("empty app id")

// Record is the current registered-App subject inventory. App access policy is
// evaluated by the operation contract and protected-session owners, not by a
// registry-local mode or scope ceiling.
type Record struct {
	AppID     string
	UpdatedAt time.Time
	Instances map[string]InstanceRecord
}

type InstanceRecord struct {
	AppInstanceID string
	DeviceID      string
	Capabilities  []string
	RegisteredAt  time.Time
}

// Registry stores current registered-App subject identity in memory.
type Registry struct {
	mu   sync.RWMutex
	apps map[string]Record
}

func New() *Registry {
	return &Registry{apps: make(map[string]Record)}
}

func (r *Registry) UpsertInstance(appID string, appInstanceID string, deviceID string, capabilities []string) error {
	appID = strings.TrimSpace(appID)
	appInstanceID = strings.TrimSpace(appInstanceID)
	if appID == "" || appInstanceID == "" {
		return fmt.Errorf("appregistry.UpsertInstance: %w", ErrEmptyAppID)
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	now := time.Now().UTC()
	record := r.apps[appID]
	record.AppID = appID
	record.UpdatedAt = now
	if record.Instances == nil {
		record.Instances = make(map[string]InstanceRecord)
	}
	record.Instances[appInstanceID] = InstanceRecord{
		AppInstanceID: appInstanceID,
		DeviceID:      strings.TrimSpace(deviceID),
		Capabilities:  append([]string(nil), capabilities...),
		RegisteredAt:  now,
	}
	r.apps[appID] = record
	return nil
}

func (r *Registry) IsInstanceRegistered(appID string, appInstanceID string) bool {
	appID = strings.TrimSpace(appID)
	appInstanceID = strings.TrimSpace(appInstanceID)
	if appID == "" || appInstanceID == "" {
		return false
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	record, ok := r.apps[appID]
	if !ok {
		return false
	}
	_, ok = record.Instances[appInstanceID]
	return ok
}

func cloneInstances(input map[string]InstanceRecord) map[string]InstanceRecord {
	if len(input) == 0 {
		return nil
	}
	output := make(map[string]InstanceRecord, len(input))
	for key, value := range input {
		value.Capabilities = append([]string(nil), value.Capabilities...)
		output[key] = value
	}
	return output
}

func (r *Registry) Get(appID string) (Record, bool) {
	appID = strings.TrimSpace(appID)
	if appID == "" {
		return Record{}, false
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	record, ok := r.apps[appID]
	if !ok {
		return Record{}, false
	}
	record.Instances = cloneInstances(record.Instances)
	return record, true
}
