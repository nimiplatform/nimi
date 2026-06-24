//go:build darwin && cgo

package account

/*
#cgo CFLAGS: -x objective-c -fobjc-arc -fblocks
#cgo LDFLAGS: -framework Foundation -framework LocalAuthentication
#import <Foundation/Foundation.h>
#import <LocalAuthentication/LocalAuthentication.h>
#import <dispatch/dispatch.h>
#include <stdlib.h>

typedef struct {
	int outcome;
	char *detail;
} NimiLocalAuthenticationResult;

static char *NimiDupNSString(NSString *value) {
	if (value == nil) {
		return NULL;
	}
	const char *utf8 = [value UTF8String];
	if (utf8 == NULL) {
		return NULL;
	}
	return strdup(utf8);
}

static NimiLocalAuthenticationResult NimiEvaluateDeviceOwnerAuthentication(const char *reasonText) {
	@autoreleasepool {
		NimiLocalAuthenticationResult result;
		result.outcome = 0;
		result.detail = NULL;

		LAContext *context = [[LAContext alloc] init];
		NSError *canError = nil;
		if (![context canEvaluatePolicy:LAPolicyDeviceOwnerAuthentication error:&canError]) {
			result.outcome = 0;
			result.detail = NimiDupNSString([canError localizedDescription]);
			return result;
		}

		NSString *reason = @"Nimi needs to confirm this is you before showing protected information.";
		if (reasonText != NULL && reasonText[0] != '\0') {
			reason = [NSString stringWithUTF8String:reasonText];
		}

		dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
		__block BOOL success = NO;
		__block NSError *authError = nil;
		[context evaluatePolicy:LAPolicyDeviceOwnerAuthentication localizedReason:reason reply:^(BOOL ok, NSError *error) {
			success = ok;
			authError = error;
			dispatch_semaphore_signal(semaphore);
		}];
		dispatch_semaphore_wait(semaphore, DISPATCH_TIME_FOREVER);

		if (success) {
			result.outcome = 2;
			return result;
		}
		if (authError != nil) {
			NSInteger code = [authError code];
			if (code == LAErrorUserCancel || code == LAErrorUserFallback || code == LAErrorSystemCancel || code == LAErrorAppCancel) {
				result.outcome = 1;
				result.detail = NimiDupNSString([authError localizedDescription]);
				return result;
			}
			result.detail = NimiDupNSString([authError localizedDescription]);
		}
		result.outcome = 0;
		return result;
	}
}
*/
import "C"

import (
	"context"
	"strings"
	"unsafe"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

type darwinLocalAuthenticationProvider struct{}

func newPlatformHostPresenceProvider() hostPresenceProvider {
	return darwinLocalAuthenticationProvider{}
}

func (darwinLocalAuthenticationProvider) RequestHostPresence(ctx context.Context, request hostPresenceRequest) (hostPresenceResult, error) {
	select {
	case <-ctx.Done():
		return hostPresenceResult{
			Outcome: hostPresenceRejected,
			Method:  runtimev1.PresenceVerificationMethod_PRESENCE_VERIFICATION_METHOD_OS_CREDENTIAL,
		}, nil
	default:
	}
	reason := C.CString(darwinPresencePromptMessage(request))
	defer C.free(unsafe.Pointer(reason))
	result := C.NimiEvaluateDeviceOwnerAuthentication(reason)
	if result.detail != nil {
		C.free(unsafe.Pointer(result.detail))
	}
	switch int(result.outcome) {
	case int(hostPresenceVerified):
		return hostPresenceResult{
			Outcome: hostPresenceVerified,
			Method:  runtimev1.PresenceVerificationMethod_PRESENCE_VERIFICATION_METHOD_OS_CREDENTIAL,
		}, nil
	case int(hostPresenceRejected):
		return hostPresenceResult{
			Outcome: hostPresenceRejected,
			Method:  runtimev1.PresenceVerificationMethod_PRESENCE_VERIFICATION_METHOD_OS_CREDENTIAL,
		}, nil
	default:
		return hostPresenceResult{Outcome: hostPresenceUnavailable}, nil
	}
}

func darwinPresencePromptMessage(request hostPresenceRequest) string {
	displayName := strings.TrimSpace(request.DisplayName)
	if displayName == "" {
		displayName = strings.TrimSpace(request.AccountID)
	}
	if displayName == "" {
		return "Confirm this is you before showing protected Nimi information."
	}
	return "Confirm this is " + displayName + " before showing protected Nimi information."
}
