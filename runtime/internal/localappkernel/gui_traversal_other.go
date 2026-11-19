//go:build !darwin || !cgo

package localappkernel

func prepareNewAppDirectory(string, VerifiedLocalOSUserIdentity) error {
	return nil
}
