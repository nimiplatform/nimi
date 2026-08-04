package daemon

import (
	"io"
	"log/slog"
	"testing"
)

func TestDaemonWiresMachineLocalExecutionResolver(t *testing.T) {
	daemon := newTestDaemon(t, slog.New(slog.NewTextHandler(io.Discard, nil)))
	agentService := daemon.grpc.AgentService()
	if agentService == nil || !agentService.HasMachineExecutionBindingResolver() {
		t.Fatal("daemon did not wire machine-local execution into Runtime Agent")
	}
}
