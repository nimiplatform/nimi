//go:build !windows

package daemonctl

import (
	"fmt"
	"time"
)

func newProtectedServiceController() protectedServiceController {
	return unsupportedProtectedServiceController{}
}

type unsupportedProtectedServiceController struct{}

func (unsupportedProtectedServiceController) Status() (protectedServiceStatus, error) {
	return protectedServiceStatus{}, fmt.Errorf("protected Runtime service controller is unavailable on this OS")
}

func (unsupportedProtectedServiceController) Start(time.Duration) (protectedServiceStatus, error) {
	return protectedServiceStatus{}, fmt.Errorf("protected Runtime service controller is unavailable on this OS")
}

func (unsupportedProtectedServiceController) Stop(time.Duration) (protectedServiceStatus, error) {
	return protectedServiceStatus{}, fmt.Errorf("protected Runtime service controller is unavailable on this OS")
}
