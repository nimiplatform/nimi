package main

func runtimeChecklist() []checklistItemSpec {
	const (
		pkgAppRegistry  = "github.com/nimiplatform/nimi/runtime/internal/appregistry"
		pkgApp          = "github.com/nimiplatform/nimi/runtime/internal/services/app"
		pkgAuthn        = "github.com/nimiplatform/nimi/runtime/internal/authn"
		pkgAuditLog     = "github.com/nimiplatform/nimi/runtime/internal/auditlog"
		pkgAuditSvc     = "github.com/nimiplatform/nimi/runtime/internal/services/audit"
		pkgAI           = "github.com/nimiplatform/nimi/runtime/internal/services/ai"
		pkgAuth         = "github.com/nimiplatform/nimi/runtime/internal/services/auth"
		pkgConfig       = "github.com/nimiplatform/nimi/runtime/internal/config"
		pkgConnector    = "github.com/nimiplatform/nimi/runtime/internal/services/connector"
		pkgDaemon       = "github.com/nimiplatform/nimi/runtime/internal/daemon"
		pkgGrant        = "github.com/nimiplatform/nimi/runtime/internal/services/grant"
		pkgGrpc         = "github.com/nimiplatform/nimi/runtime/internal/grpcserver"
		pkgGrpcErr      = "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
		pkgKnowledge    = "github.com/nimiplatform/nimi/runtime/internal/services/knowledge"
		pkgLocalService = "github.com/nimiplatform/nimi/runtime/internal/services/localservice"
		pkgModel        = "github.com/nimiplatform/nimi/runtime/internal/services/model"
		pkgNimillm      = "github.com/nimiplatform/nimi/runtime/internal/nimillm"
		pkgProtocol     = "github.com/nimiplatform/nimi/runtime/internal/protocol"
		pkgScheduler    = "github.com/nimiplatform/nimi/runtime/internal/scheduler"
		pkgStreamutil   = "github.com/nimiplatform/nimi/runtime/internal/streamutil"
		pkgWorkflow     = "github.com/nimiplatform/nimi/runtime/internal/services/workflow"
	)

	return append(runtimeChecklistPart1(
		pkgAppRegistry,
		pkgAI,
		pkgAuditLog,
		pkgAuditSvc,
		pkgGrant,
		pkgGrpc,
		pkgModel,
		pkgNimillm,
		pkgScheduler,
		pkgWorkflow,
	), runtimeChecklistPart2(
		pkgAI,
		pkgApp,
		pkgAppRegistry,
		pkgAuth,
		pkgAuthn,
		pkgAuditLog,
		pkgAuditSvc,
		pkgConfig,
		pkgConnector,
		pkgDaemon,
		pkgGrpc,
		pkgGrpcErr,
		pkgKnowledge,
		pkgLocalService,
		pkgModel,
		pkgNimillm,
		pkgProtocol,
		pkgStreamutil,
		pkgWorkflow,
	)...)
}
