package protectedlocal

import "fmt"

func validateNonProductWindowsRuntimeProfile(profile windowsRuntimeProfile) error {
	return fmt.Errorf("non-product fixture profile is forbidden in this build")
}
