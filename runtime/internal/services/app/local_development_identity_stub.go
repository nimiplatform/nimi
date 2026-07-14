//go:build !windows

package app

func localDevelopmentCanonicalProjectFileID(string) (string, error) {
	return "", errLocalDevelopmentProjectChanged
}
