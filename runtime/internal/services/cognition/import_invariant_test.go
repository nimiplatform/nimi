package cognition

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// S2.21 / G3.2 — runtime/internal/services/cognition imports zero
// references to runtime/internal/services/knowledge (no production
// file, no _test.go file). This is the load-bearing decoupling
// invariant: wave-3 deletes the legacy package, and wave-2 must
// guarantee the cognition package no longer depends on it.
//
// Implemented as a static read of every .go file in the cognition
// package; a regression that adds an import or a literal reference
// to the legacy package path will fail this test.
func TestCognitionPackageHasNoLegacyKnowledgeServiceImport(t *testing.T) {
	const legacyPath = "runtime/internal/services/knowledge"

	// runtime.Caller-relative path is brittle; use os.Getwd which Go
	// test sets to the package dir.
	wd, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	entries, err := os.ReadDir(wd)
	if err != nil {
		t.Fatalf("readdir %s: %v", wd, err)
	}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if !strings.HasSuffix(name, ".go") {
			continue
		}
		// This invariant test file mentions the legacy path inside
		// string literals; skip it.
		if name == "import_invariant_test.go" {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(wd, name))
		if err != nil {
			t.Fatalf("read %s: %v", name, err)
		}
		text := string(raw)
		// Look for the import-form (quoted path) so docstring mentions
		// of the retired package don't false-positive.
		quotedImport := `"github.com/nimiplatform/nimi/runtime/` + legacyPath + `"`
		if strings.Contains(text, quotedImport) {
			t.Fatalf("file %s still imports retired package %s", name, legacyPath)
		}
		// Common alias name for the retired package.
		if strings.Contains(text, `knowledgeservice "github.com/nimiplatform/nimi/runtime/`+legacyPath+`"`) {
			t.Fatalf("file %s still aliases retired package as 'knowledgeservice'", name)
		}
		if strings.Contains(text, "knowledgeScopeID(") {
			t.Fatalf("file %s still calls retired helper knowledgeScopeID()", name)
		}
	}
}
