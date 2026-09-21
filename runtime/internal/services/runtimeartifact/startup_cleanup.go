package runtimeartifact

import (
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// ReconcileAbandonedWrites runs only during the owning Runtime's quiescent
// bootstrap, before this store is exposed to any producer or reader. A stream
// candidate and a payload without a metadata commit were never published.
func (s *DiskStore) ReconcileAbandonedWrites() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	entries, err := os.ReadDir(s.payloadsDir)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		candidate := strings.HasPrefix(name, ".artifact-candidate-")
		if !candidate && strings.HasSuffix(name, ".bin") {
			key := strings.TrimSuffix(name, ".bin")
			if decoded, err := hex.DecodeString(key); err != nil || len(decoded) != 32 {
				continue
			}
			_, err := os.Stat(filepath.Join(s.recordsDir, key+".json"))
			if err == nil {
				continue
			}
			if !os.IsNotExist(err) {
				return fmt.Errorf("inspect artifact commit: %w", err)
			}
			candidate = true
		}
		if candidate {
			if err := os.Remove(filepath.Join(s.payloadsDir, name)); err != nil {
				return fmt.Errorf("remove abandoned artifact write: %w", err)
			}
		}
	}
	return nil
}
