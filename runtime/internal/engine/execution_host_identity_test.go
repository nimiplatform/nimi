package engine

import "testing"

func TestSupervisorProjectsPrivateExecutionHostIdentity(t *testing.T) {
	cfg := DefaultMediaConfig()
	cfg.ExecutionHostIdentity = "profile-root-and-driver-proof"
	supervisor := NewSupervisor(cfg, nil, nil)

	info := supervisor.Info()
	if info.ExecutionHostIdentity != cfg.ExecutionHostIdentity {
		t.Fatalf("Supervisor identity = %q, want %q", info.ExecutionHostIdentity, cfg.ExecutionHostIdentity)
	}
	dto := supervisorInfoToDTO(info)
	if dto.ExecutionHostIdentity != cfg.ExecutionHostIdentity {
		t.Fatalf("service adapter identity = %q, want %q", dto.ExecutionHostIdentity, cfg.ExecutionHostIdentity)
	}
}
