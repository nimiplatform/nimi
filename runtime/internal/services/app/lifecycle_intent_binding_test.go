package app

import (
	"testing"

	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
)

func TestWithLifecycleIntentManagerRetainsExactAuthority(t *testing.T) {
	manager := &protectedlocal.LifecycleIntentManager{}
	service := New(testLogger(), WithLifecycleIntentManager(manager))
	if service.lifecycleIntents != manager {
		t.Fatal("App service did not retain the exact protected lifecycle authority")
	}
}
