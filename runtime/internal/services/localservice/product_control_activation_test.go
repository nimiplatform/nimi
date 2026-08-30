package localservice

import (
	"path/filepath"
	"testing"
)

func TestCurrentProductControlRootActivationIDRequiresCurrentRuntimeBinding(t *testing.T) {
	home := setProductControlHomeForTest(t)
	service := newTestService(t)
	root := filepath.Join(home, "activation-root")
	ready := readyProductControlForReplacementTest(t, service, root)
	activationID, active, err := service.CurrentProductControlRootActivationID()
	if err != nil || !active || activationID != ready.Record.DataRoot.RootActivationID {
		t.Fatalf("current activation id=%q active=%v err=%v ready=%+v", activationID, active, err, ready.Record.DataRoot)
	}
	service.mu.Lock()
	service.runtimeDataRoot = filepath.Join(home, "other-root")
	service.mu.Unlock()
	if _, _, err := service.CurrentProductControlRootActivationID(); err == nil {
		t.Fatal("activation token was exposed to a Runtime bound to another root")
	}
}
