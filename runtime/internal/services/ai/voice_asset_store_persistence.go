package ai

import (
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/encoding/protojson"
)

const (
	voiceAssetDiskStoreDirName  = "runtime-voice-assets"
	voiceAssetDiskStoreFileName = "voice-assets.json"
)

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
	var snapshot runtimev1.ListVoiceAssetsResponse
	if err := (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(raw, &snapshot); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, asset := range snapshot.GetAssets() {
		if !isPersistableVoiceAsset(asset) {
			continue
		}
		s.assets[strings.TrimSpace(asset.GetVoiceAssetId())] = cloneVoiceAsset(asset)
	}
	return nil
}

func (s *voiceAssetStore) persistDurableAssetsLocked() error {
	if s == nil || strings.TrimSpace(s.durablePath) == "" {
		return nil
	}
	assets := make([]*runtimev1.VoiceAsset, 0, len(s.assets))
	for _, asset := range s.assets {
		if !isPersistableVoiceAsset(asset) {
			continue
		}
		assets = append(assets, cloneVoiceAsset(asset))
	}
	sort.Slice(assets, func(i, j int) bool {
		return strings.TrimSpace(assets[i].GetVoiceAssetId()) < strings.TrimSpace(assets[j].GetVoiceAssetId())
	})
	raw, err := (protojson.MarshalOptions{UseProtoNames: true}).Marshal(&runtimev1.ListVoiceAssetsResponse{Assets: assets})
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

func isPersistableVoiceAsset(asset *runtimev1.VoiceAsset) bool {
	return asset != nil &&
		strings.TrimSpace(asset.GetVoiceAssetId()) != "" &&
		asset.GetPersistence() == runtimev1.VoiceAssetPersistence_VOICE_ASSET_PERSISTENCE_PROVIDER_PERSISTENT &&
		strings.TrimSpace(asset.GetProviderVoiceRef()) != ""
}
