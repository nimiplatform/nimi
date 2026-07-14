package grpcserver

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

// immutablePackageDenyAllMethods is the 0K transport hardcut. The methods stay
// in the frozen wire epoch, but no public, Desktop-control, or local-app-host
// transport may route them to a handler before 0P/P admits package behavior.
var immutablePackageDenyAllMethods = map[string]struct{}{
	"/nimi.runtime.v1.RuntimeAppService/PrepareAppLifecycleIntent":   {},
	"/nimi.runtime.v1.RuntimeAppService/GetAppLifecycleIntentStatus": {},
	"/nimi.runtime.v1.RuntimeAppService/InstallApp":                  {},
	"/nimi.runtime.v1.RuntimeAppService/UninstallApp":                {},
	"/nimi.runtime.v1.RuntimeAppService/GetAppInstallJob":            {},
	"/nimi.runtime.v1.RuntimeAppService/ListAppInstallJobs":          {},
	"/nimi.runtime.v1.RuntimeAppService/WatchAppInstallJobEvents":    {},
	"/nimi.runtime.v1.RuntimeAppService/UpdateApp":                   {},
	"/nimi.runtime.v1.RuntimeAppService/HealthRepairApp":             {},
}

func immutablePackageTransportDenied(method string) bool {
	_, denied := immutablePackageDenyAllMethods[method]
	return denied
}

func immutablePackageTransportUnavailable() error {
	return grpcerr.WithReasonCode(codes.Unimplemented, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
}
