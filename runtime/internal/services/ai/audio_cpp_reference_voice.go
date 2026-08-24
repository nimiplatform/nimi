// @nimi-authority: rule.nimi.runtime.local-compute.r074

package ai

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

const (
	audioCppReferenceVoicePrefix  = capabilitydriver.AudioCppReferenceVoicePrefix
	audioCppReferenceVoiceMaxWAV  = 512 << 20
	audioCppReferenceVoiceMaxMeta = 32 << 10
)

type audioCppReferenceVoiceMetadata struct {
	MIMEType      string `json:"mime_type"`
	ReferenceText string `json:"reference_text,omitempty"`
}

func (s *Service) captureAudioCppReferenceVoice(providerRef string, stagingWAVPath string) (*capabilitydriver.AudioCppReferenceVoiceInput, error) {
	id, err := audioCppReferenceVoiceID(providerRef)
	if err != nil {
		return nil, err
	}
	root, err := s.audioCppReferenceVoiceRoot()
	if err != nil {
		return nil, err
	}
	wavPath := filepath.Join(root, id+".wav")
	metaPath := filepath.Join(root, id+".json")
	wav, err := os.ReadFile(wavPath)
	if err != nil {
		return nil, fmt.Errorf("read audio.cpp reference voice: %w", err)
	}
	if len(wav) == 0 || len(wav) > audioCppReferenceVoiceMaxWAV {
		return nil, fmt.Errorf("audio.cpp reference voice WAV size is invalid")
	}
	info, err := os.Stat(metaPath)
	if err != nil || info.Size() <= 0 || info.Size() > audioCppReferenceVoiceMaxMeta {
		return nil, fmt.Errorf("audio.cpp reference voice metadata is invalid")
	}
	metadataBytes, err := os.ReadFile(metaPath)
	if err != nil {
		return nil, fmt.Errorf("read audio.cpp reference voice metadata: %w", err)
	}
	var metadata audioCppReferenceVoiceMetadata
	if json.Unmarshal(metadataBytes, &metadata) != nil {
		return nil, fmt.Errorf("decode audio.cpp reference voice metadata")
	}
	return &capabilitydriver.AudioCppReferenceVoiceInput{
		ProviderVoiceRef: strings.TrimSpace(providerRef),
		WAVPath:          filepath.Clean(stagingWAVPath),
		WAVBytes:         append([]byte(nil), wav...),
		MIMEType:         strings.TrimSpace(metadata.MIMEType),
		ReferenceText:    strings.TrimSpace(metadata.ReferenceText),
	}, nil
}

func (s *Service) audioCppReferenceVoiceRoot() (string, error) {
	if s == nil || !filepath.IsAbs(strings.TrimSpace(s.localSpeechStagingRoot)) {
		return "", fmt.Errorf("Runtime audio.cpp reference voice root is unavailable")
	}
	return filepath.Join(filepath.Clean(s.localSpeechStagingRoot), "voice-assets"), nil
}

// cleanupAudioCppReferenceVoicesAtStartup removes only files owned by the
// previous Runtime session. Session-ephemeral VoiceAssets are never restored,
// so retaining their private reference payloads beyond startup would extend
// their lifetime without a public owner.
func (s *Service) cleanupAudioCppReferenceVoicesAtStartup() error {
	if s == nil || !filepath.IsAbs(strings.TrimSpace(s.localSpeechStagingRoot)) {
		return fmt.Errorf("Runtime speech staging root is unavailable")
	}
	stagingRoot := filepath.Clean(s.localSpeechStagingRoot)
	stagingInfo, err := os.Lstat(stagingRoot)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("inspect Runtime speech staging root: %w", err)
	}
	if stagingInfo.Mode()&os.ModeSymlink != 0 || !stagingInfo.IsDir() {
		return fmt.Errorf("Runtime speech staging root is not a direct directory")
	}
	root, err := s.audioCppReferenceVoiceRoot()
	if err != nil {
		return err
	}
	rootInfo, err := os.Lstat(root)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("inspect audio.cpp reference voice root: %w", err)
	}
	if rootInfo.Mode()&os.ModeSymlink != 0 || !rootInfo.IsDir() {
		return fmt.Errorf("audio.cpp reference voice root is not a direct directory")
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return fmt.Errorf("read audio.cpp reference voice root: %w", err)
	}
	for _, entry := range entries {
		if _, ok := audioCppReferenceVoiceFileID(entry.Name()); !ok {
			continue
		}
		path := filepath.Join(root, entry.Name())
		info, err := os.Lstat(path)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return fmt.Errorf("inspect audio.cpp reference voice file: %w", err)
		}
		if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
			continue
		}
		if err := os.Remove(path); err != nil {
			return fmt.Errorf("remove previous-session audio.cpp reference voice file: %w", err)
		}
	}
	return nil
}

func (s *Service) deleteAudioCppReferenceVoice(providerRef string) error {
	id, err := audioCppReferenceVoiceID(providerRef)
	if err != nil {
		return err
	}
	root, err := s.audioCppReferenceVoiceRoot()
	if err != nil {
		return err
	}
	for _, suffix := range []string{".wav", ".json", ".wav.tmp", ".json.tmp"} {
		if err := os.Remove(filepath.Join(root, id+suffix)); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("delete audio.cpp reference voice: %w", err)
		}
	}
	return nil
}

func audioCppReferenceVoiceID(providerRef string) (string, error) {
	value := strings.TrimSpace(providerRef)
	if !strings.HasPrefix(value, audioCppReferenceVoicePrefix) {
		return "", fmt.Errorf("audio.cpp reference voice handle is invalid")
	}
	id := strings.TrimPrefix(value, audioCppReferenceVoicePrefix)
	if len(id) < 10 || len(id) > 64 {
		return "", fmt.Errorf("audio.cpp reference voice handle is invalid")
	}
	for _, char := range id {
		if (char < 'a' || char > 'z') && (char < 'A' || char > 'Z') && (char < '0' || char > '9') && char != '-' && char != '_' {
			return "", fmt.Errorf("audio.cpp reference voice handle is invalid")
		}
	}
	return id, nil
}

func audioCppReferenceVoiceFileID(name string) (string, bool) {
	for _, suffix := range [...]string{".wav.tmp", ".json.tmp", ".wav", ".json"} {
		if !strings.HasSuffix(name, suffix) {
			continue
		}
		id := strings.TrimSuffix(name, suffix)
		validated, err := audioCppReferenceVoiceID(audioCppReferenceVoicePrefix + id)
		return validated, err == nil && validated == id
	}
	return "", false
}
