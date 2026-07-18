//go:build !windows && !darwin

package app

import runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"

func localDevelopmentHostExecutable(localDevelopmentProjectSnapshot) (string, error) {
	return "", errLocalDevelopmentProjectChanged
}

func localDevelopmentProjectHostAliasPath(string, runtimev1.LocalDevelopmentShellKind) string {
	return ""
}

func validLocalDevelopmentHostPath(string, string, runtimev1.LocalDevelopmentShellKind) bool {
	return false
}
