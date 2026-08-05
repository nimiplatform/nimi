package ai

import runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"

// localProvider is only the committed Local route marker. Execution is owned
// by the selected capability Driver; ambient endpoints and backend registries
// are deliberately absent.
type localProvider struct{}

func (p *localProvider) Route() runtimev1.RoutePolicy {
	return runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL
}
