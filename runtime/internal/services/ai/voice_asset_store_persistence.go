package ai

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/runtimeidentity"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/structpb"
)

const (
	voiceAssetDiskStoreDirName  = "runtime-voice-assets"
	voiceAssetDiskStoreFileName = "voice-assets.json"
	voiceAssetDiskStoreVersion  = 2
)

type voiceAssetDiskSnapshot struct {
	Version int                    `json:"version"`
	Records []voiceAssetDiskRecord `json:"records"`
}

type voiceAssetDiskRecord struct {
	Asset               json.RawMessage                             `json:"asset"`
	Target              *runtimeidentity.Target                     `json:"target"`
	CapabilityContract  string                                      `json:"capability_contract,omitempty"`
	Implementation      *runtimev1.CapabilityImplementationIdentity `json:"implementation,omitempty"`
	ProviderModelTarget map[string]any                              `json:"provider_model_target,omitempty"`
	ConnectorID         string                                      `json:"connector_id"`
}

func newVoiceAssetStoreForLocalStatePath(localStatePath string) (*voiceAssetStore, error) {
	store := newVoiceAssetStore()
	store.durablePath = voiceAssetStorePathForLocalStatePath(localStatePath)
	if strings.TrimSpace(store.durablePath) == "" {
		return store, nil
	}
	if err := store.loadDurableAssets(); err != nil {
		return nil, err
	}
	return store, nil
}

func voiceAssetStorePathForLocalStatePath(localStatePath string) string {
	trimmed := strings.TrimSpace(localStatePath)
	if trimmed == "" {
		return ""
	}
	return filepath.Join(filepath.Dir(trimmed), voiceAssetDiskStoreDirName, voiceAssetDiskStoreFileName)
}

func (s *voiceAssetStore) loadDurableAssets() error {
	if s == nil || strings.TrimSpace(s.durablePath) == "" {
		return nil
	}
	raw, err := os.ReadFile(s.durablePath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	var snapshot voiceAssetDiskSnapshot
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&snapshot); err != nil {
		return err
	}
	if snapshot.Version != voiceAssetDiskStoreVersion {
		return fmt.Errorf("unsupported voice asset store version %d", snapshot.Version)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for index, record := range snapshot.Records {
		var asset runtimev1.VoiceAsset
		if err := (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(record.Asset, &asset); err != nil {
			return err
		}
		if !isPersistableVoiceAsset(&asset, record.Target) {
			return fmt.Errorf("voice asset store record %d is not a valid provider-persistent asset", index)
		}
		if len(record.ProviderModelTarget) == 0 {
			return fmt.Errorf("voice asset store record %d has no provider-model target", index)
		}
		connectorID := record.ConnectorID
		if record.Target.Cloud == nil || connectorID == "" || connectorID != strings.TrimSpace(connectorID) || connectorID != record.Target.Cloud.ConnectorID {
			return fmt.Errorf("voice asset store record %d has no exact Connector identity", index)
		}
		providerTarget, buildErr := structpb.NewStruct(record.ProviderModelTarget)
		if buildErr != nil {
			return buildErr
		}
		binding := (&voiceAssetCloudBinding{
			CapabilityContract: record.CapabilityContract, Implementation: record.Implementation,
			ProviderModelTarget: providerTarget, ConnectorID: connectorID,
		}).Clone()
		if !binding.Valid() {
			return fmt.Errorf("voice asset store record %d has no exact AIConfig execution binding", index)
		}
		id := strings.TrimSpace(asset.GetVoiceAssetId())
		s.assets[id] = cloneVoiceAsset(&asset)
		s.targets[id] = record.Target.Clone()
		s.cloudBindings[id] = binding
	}
	return nil
}

func (s *voiceAssetStore) persistDurableAssetsLocked() error {
	if s == nil || strings.TrimSpace(s.durablePath) == "" {
		return nil
	}
	ids := make([]string, 0, len(s.assets))
	for id, asset := range s.assets {
		if !isPersistableVoiceAsset(asset, s.targets[id]) {
			continue
		}
		binding := s.cloudBindings[id]
		if binding == nil || !binding.Valid() {
			return fmt.Errorf("provider-persistent voice asset %s has no exact AIConfig execution binding", id)
		}
		target := s.targets[id]
		if target.Cloud == nil || target.Cloud.ConnectorID != strings.TrimSpace(binding.ConnectorID) {
			return fmt.Errorf("provider-persistent voice asset %s has no exact Connector identity", id)
		}
		ids = append(ids, id)
	}
	sort.Strings(ids)
	snapshot := voiceAssetDiskSnapshot{Version: voiceAssetDiskStoreVersion, Records: make([]voiceAssetDiskRecord, 0, len(ids))}
	for _, id := range ids {
		assetRaw, err := (protojson.MarshalOptions{UseProtoNames: true}).Marshal(s.assets[id])
		if err != nil {
			return err
		}
		record := voiceAssetDiskRecord{
			Asset:  append(json.RawMessage(nil), assetRaw...),
			Target: s.targets[id].Clone(),
		}
		if binding := s.cloudBindings[id]; binding != nil && binding.Valid() {
			record.CapabilityContract = binding.CapabilityContract
			record.Implementation = binding.Clone().Implementation
			record.ProviderModelTarget = binding.ProviderModelTarget.AsMap()
			record.ConnectorID = strings.TrimSpace(binding.ConnectorID)
		}
		snapshot.Records = append(snapshot.Records, record)
	}
	raw, err := json.Marshal(snapshot)
	if err != nil {
		return err
	}
	dir := filepath.Dir(s.durablePath)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, voiceAssetDiskStoreFileName+".tmp-*")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	if _, err := tmp.Write(raw); err != nil {
		_ = tmp.Close()
		_ = os.Remove(tmpPath)
		return err
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(tmpPath)
		return err
	}
	if err := os.Chmod(tmpPath, 0o600); err != nil {
		_ = os.Remove(tmpPath)
		return err
	}
	if err := os.Rename(tmpPath, s.durablePath); err != nil {
		_ = os.Remove(tmpPath)
		return err
	}
	return nil
}

func isPersistableVoiceAsset(asset *runtimev1.VoiceAsset, target *runtimeidentity.Target) bool {
	return asset != nil &&
		target != nil && target.Valid() &&
		strings.TrimSpace(asset.GetVoiceAssetId()) != "" &&
		asset.GetPersistence() == runtimev1.VoiceAssetPersistence_VOICE_ASSET_PERSISTENCE_PROVIDER_PERSISTENT &&
		strings.TrimSpace(asset.GetProviderVoiceRef()) != ""
}
