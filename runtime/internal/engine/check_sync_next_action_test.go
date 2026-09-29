package engine

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

// Home parses the same fixture (apps/desktop/test/check-sync-next-action.test.ts)
// so the Runtime-owned closed set and its consumer cannot drift apart.
func TestCheckSyncNextActionsMatchConsumerFixture(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("testdata", "check-sync-next-actions.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fixture []CheckSyncNextAction
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	if got := CheckSyncNextActions(); !reflect.DeepEqual(got, fixture) {
		t.Fatalf("Check & Sync next actions %v drifted from the consumer fixture %v", got, fixture)
	}
}
