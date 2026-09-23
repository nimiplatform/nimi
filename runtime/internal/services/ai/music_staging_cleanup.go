package ai

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Called after startup interrupted prior Jobs and before this service admits
// work. Only names allocated by Runtime's numeric CreateTemp/MkdirTemp paths
// are removed; unknown entries and links to directories are not traversed.
func cleanupMusicStagingAtStartup(stateDirectory string) error {
	for _, profile := range []struct{ root, prefix string }{{"music-staging", "music-"}, {"audio-preparation-staging", "prepare-"}, {"speech-staging", "sep-"}} {
		root := filepath.Join(stateDirectory, profile.root)
		entries, err := os.ReadDir(root)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return err
		}
		for _, entry := range entries {
			name := entry.Name()
			path := filepath.Join(root, name)
			if !entry.IsDir() {
				stem := strings.TrimSuffix(strings.TrimSuffix(name, ".tmp"), ".wav")
				if profile.root == "music-staging" && numericTemporaryName(stem, "music-") {
					if err := os.Remove(path); err != nil {
						return fmt.Errorf("remove abandoned music staging: %w", err)
					}
				}
				continue
			}
			if entry.Type()&os.ModeSymlink != 0 || !numericTemporaryName(name, profile.prefix) {
				continue
			}
			children, err := os.ReadDir(path)
			if err != nil {
				return err
			}
			for _, child := range children {
				if child.IsDir() {
					var innerNames []string
					switch {
					case profile.root == "music-staging" && child.Name() == "music":
						// The native request id is fixed by the Driver, not supplied by the App.
						innerNames = []string{"score.abc"}
					case profile.root == "speech-staging" && child.Name() == "stems":
						// Stems written by the HTDemucs CLI and the Runtime-built background.
						innerNames = []string{"vocals.wav", "drums.wav", "bass.wav", "other.wav", "background.wav"}
					}
					if innerNames == nil || child.Type()&os.ModeSymlink != 0 {
						continue
					}
					inner := filepath.Join(path, child.Name())
					for _, innerName := range innerNames {
						if err := os.Remove(filepath.Join(inner, innerName)); err != nil && !os.IsNotExist(err) {
							return err
						}
					}
					remaining, err := os.ReadDir(inner)
					if err != nil {
						return err
					}
					if len(remaining) == 0 {
						if err := os.Remove(inner); err != nil {
							return err
						}
					}
					continue
				}
				name := child.Name()
				var owned bool
				switch profile.root {
				case "music-staging":
					// Generation, transcription and voice conversion stage these exact names.
					owned = name == "music.wav" || name == "music.wav.tmp" || name == "request.json" || name == "input.abc" || name == "score.abc" ||
						name == "source.wav" || name == "target.wav" || name == "vocal.wav" || name == "events.json" || name == "timeline.json" ||
						numericTemporaryName(name, "input-") || numericTemporaryName(strings.TrimSuffix(name, ".wav"), "canonical-audio-")
				case "speech-staging":
					owned = name == "source.wav"
				default:
					owned = numericTemporaryName(name, "input-") || numericTemporaryName(strings.TrimSuffix(name, ".wav"), "canonical-audio-")
				}
				if owned {
					if err := os.Remove(filepath.Join(path, name)); err != nil {
						return err
					}
				}
			}
			remaining, err := os.ReadDir(path)
			if err != nil {
				return err
			}
			if len(remaining) == 0 {
				if err := os.Remove(path); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

func numericTemporaryName(name, prefix string) bool {
	if !strings.HasPrefix(name, prefix) {
		return false
	}
	suffix := strings.TrimPrefix(name, prefix)
	if suffix == "" {
		return false
	}
	for _, ch := range suffix {
		if ch < '0' || ch > '9' {
			return false
		}
	}
	return true
}
