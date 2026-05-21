package runtimeagent

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestRuntimeHoldsNoGuideConstant is the K-AGCORE-140 "Source of truth"
// anti-regression guard. The amended K-AGCORE-140 states:
//
//	Runtime MUST NOT hold a runtime-local hardcoded guide welcome string, guide
//	prompt, or guide identity constant as parallel product truth;
//
// and K-AGCORE-139's MUST-NOT forbids a "special official-guide path". The
// Nimi guide welcome copy and system prompt are ordinary RealmAgent profile
// content (`AgentProfile.greeting` / `systemPromptBase` from the W1 backend
// bootstrap) reached through ordinary Realm/SDK projection.
//
// This guard walks every non-generated, non-test `.go` file under `runtime/`
// and fails if any references the Nimi guide agent by name. A guide constant,
// catalog, branch, or welcome string would necessarily mention the guide
// agent, so a name-level scan mechanically locks the rule in.
//
// Scope of the scan:
//   - includes: all `*.go` source under the runtime module root;
//   - excludes: `*_test.go` (tests legitimately reference the guide
//     realm_agent_id as an opaque input — see
//     guide_localagent_projection_test.go), `gen/` (generated proto), and
//     `vendor/`.
func TestRuntimeHoldsNoGuideConstant(t *testing.T) {
	t.Parallel()

	runtimeRoot := runtimeModuleRoot(t)

	// Guide-identifying tokens. These name the Nimi guide agent specifically;
	// a guide constant/catalog/branch cannot exist without one of them.
	// Generic words (e.g. "guide" as a projection-kind classifier in
	// cognition) are intentionally NOT in this list — only guide-agent
	// identity tokens are.
	forbidden := []string{
		"archivist",
		"nimi-guide",
		"nimiguide",
		"nimi_guide",
		"guideagent",
		"guide_agent",
		"guide-agent",
	}

	var violations []string
	err := filepath.WalkDir(runtimeRoot, func(path string, d os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if d.IsDir() {
			switch d.Name() {
			case "gen", "vendor", ".git", "node_modules":
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		data, readErr := os.ReadFile(path)
		if readErr != nil {
			return readErr
		}
		lower := strings.ToLower(string(data))
		rel, _ := filepath.Rel(runtimeRoot, path)
		for _, token := range forbidden {
			if strings.Contains(lower, token) {
				violations = append(violations, rel+" -> "+token)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("walk runtime tree: %v", err)
	}

	if len(violations) > 0 {
		t.Fatalf("K-AGCORE-140 violation: runtime source must not hold a hardcoded "+
			"Nimi guide constant/prompt/identity/branch — guide content is ordinary "+
			"RealmAgent profile truth reached through Realm/SDK projection. Found:\n  %s",
			strings.Join(violations, "\n  "))
	}
}

// runtimeModuleRoot resolves the runtime Go module root by walking up from the
// test's working directory until it finds the runtime `go.mod`.
func runtimeModuleRoot(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	for {
		goMod := filepath.Join(dir, "go.mod")
		if data, statErr := os.ReadFile(goMod); statErr == nil {
			if strings.Contains(string(data), "module github.com/nimiplatform/nimi/runtime") {
				return dir
			}
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatalf("could not locate runtime module root from %s", dir)
		}
		dir = parent
	}
}
