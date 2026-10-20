package runtimeagent

import runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"

// The bounded enable/disable intents change no configuration fields and use
// the same revisioned owner commit as full configuration updates.
func (r agentAdminRuntime) enableAutonomy(req *runtimev1.EnableAutonomyRequest) (*runtimev1.EnableAutonomyResponse, error) {
	identity, entry, err := r.svc.agentEntryForIdentityContext(req.GetContext())
	if err != nil {
		return nil, err
	}
	enabled := true
	autonomy, err := r.svc.updateAgentAutonomyCAS(identity, entry.Agent.GetAutonomy().GetRevision(), agentAutonomyMutationIntent{enabled: &enabled})
	if err != nil {
		return nil, err
	}
	return &runtimev1.EnableAutonomyResponse{Autonomy: autonomy}, nil
}
func (r agentAdminRuntime) disableAutonomy(req *runtimev1.DisableAutonomyRequest) (*runtimev1.DisableAutonomyResponse, error) {
	identity, entry, err := r.svc.agentEntryForIdentityContext(req.GetContext())
	if err != nil {
		return nil, err
	}
	enabled := false
	autonomy, err := r.svc.updateAgentAutonomyCAS(identity, entry.Agent.GetAutonomy().GetRevision(), agentAutonomyMutationIntent{enabled: &enabled})
	if err != nil {
		return nil, err
	}
	return &runtimev1.DisableAutonomyResponse{Autonomy: autonomy}, nil
}
