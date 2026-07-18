//go:build !windows && !darwin

package app

func localDevelopmentCanonicalProjectFileID(string) (string, error) {
	return "", errLocalDevelopmentProjectChanged
}
