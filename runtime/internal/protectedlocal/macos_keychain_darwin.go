//go:build darwin && cgo

package protectedlocal

/*
#cgo CFLAGS: -mmacosx-version-min=13.0 -Wno-deprecated-declarations
#cgo LDFLAGS: -framework CoreFoundation -framework Security

#include <CoreFoundation/CoreFoundation.h>
#include <Security/SecAccess.h>
#include <Security/SecACL.h>
#include <Security/SecKeychain.h>
#include <Security/SecKeychainItem.h>
#include <Security/SecTrustedApplication.h>
#include <errno.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

typedef struct {
    SecKeychainRef keychain;
    SecAccessRef access;
    CFDataRef trusted_application_data;
} nimi_macos_keychain_store;

static int nimi_macos_keychain_validate_access(nimi_macos_keychain_store *store,
                                               SecKeychainItemRef item) {
    if (store == NULL || item == NULL || store->trusted_application_data == NULL) {
        return EINVAL;
    }
    SecAccessRef access = NULL;
    OSStatus status = SecKeychainItemCopyAccess(item, &access);
    if (status != errSecSuccess || access == NULL) {
        return status == errSecSuccess ? EACCES : (int)status;
    }
    CFArrayRef acl_list = NULL;
    status = SecAccessCopyACLList(access, &acl_list);
    if (status != errSecSuccess || acl_list == NULL || CFArrayGetCount(acl_list) == 0) {
        if (acl_list != NULL) CFRelease(acl_list);
        CFRelease(access);
        return status == errSecSuccess ? EACCES : (int)status;
    }
    int result = 0;
    CFIndex acl_count = CFArrayGetCount(acl_list);
    for (CFIndex index = 0; index < acl_count && result == 0; index++) {
        SecACLRef acl = (SecACLRef)CFArrayGetValueAtIndex(acl_list, index);
        CFArrayRef applications = NULL;
        CFStringRef description = NULL;
        SecKeychainPromptSelector prompt = 0;
        status = SecACLCopyContents(acl, &applications, &description, &prompt);
        if (status != errSecSuccess || applications == NULL || CFArrayGetCount(applications) != 1 ||
            prompt != 0) {
            result = status == errSecSuccess ? EACCES : (int)status;
        } else {
            SecTrustedApplicationRef application = (SecTrustedApplicationRef)CFArrayGetValueAtIndex(applications, 0);
            CFDataRef application_data = NULL;
            status = SecTrustedApplicationCopyData(application, &application_data);
            if (status != errSecSuccess || application_data == NULL ||
                !CFEqual(application_data, store->trusted_application_data)) {
                result = status == errSecSuccess ? EACCES : (int)status;
            }
            if (application_data != NULL) CFRelease(application_data);
        }
        if (applications != NULL) CFRelease(applications);
        if (description != NULL) CFRelease(description);
    }
    CFRelease(acl_list);
    CFRelease(access);
    return result;
}

static int nimi_macos_keychain_open(const char *runtime_path,
                                    nimi_macos_keychain_store **output) {
    if (runtime_path == NULL || runtime_path[0] != '/' || output == NULL) {
        return EINVAL;
    }
    *output = NULL;
    nimi_macos_keychain_store *store = calloc(1, sizeof(*store));
    if (store == NULL) {
        return ENOMEM;
    }
    OSStatus status = SecKeychainOpen("/Library/Keychains/System.keychain", &store->keychain);
    if (status != errSecSuccess || store->keychain == NULL) {
        free(store);
        return status == errSecSuccess ? EIO : (int)status;
    }
    SecTrustedApplicationRef application = NULL;
    status = SecTrustedApplicationCreateFromPath(runtime_path, &application);
    if (status != errSecSuccess || application == NULL) {
        CFRelease(store->keychain);
        free(store);
        return status == errSecSuccess ? EACCES : (int)status;
    }
    status = SecTrustedApplicationCopyData(application, &store->trusted_application_data);
    if (status != errSecSuccess || store->trusted_application_data == NULL) {
        CFRelease(application);
        CFRelease(store->keychain);
        free(store);
        return status == errSecSuccess ? EACCES : (int)status;
    }
    const void *application_values[1] = { application };
    CFArrayRef applications = CFArrayCreate(kCFAllocatorDefault, application_values, 1,
                                            &kCFTypeArrayCallBacks);
    CFStringRef description = CFSTR("Nimi Runtime protected-local custody");
    status = applications == NULL ? errSecAllocate : SecAccessCreate(description, applications, &store->access);
    if (applications != NULL) CFRelease(applications);
    CFRelease(application);
    if (status != errSecSuccess || store->access == NULL) {
        CFRelease(store->trusted_application_data);
        CFRelease(store->keychain);
        free(store);
        return status == errSecSuccess ? EACCES : (int)status;
    }
    *output = store;
    return 0;
}

static void nimi_macos_keychain_close(nimi_macos_keychain_store *store) {
    if (store == NULL) return;
    if (store->access != NULL) CFRelease(store->access);
    if (store->trusted_application_data != NULL) CFRelease(store->trusted_application_data);
    if (store->keychain != NULL) CFRelease(store->keychain);
    memset(store, 0, sizeof(*store));
    free(store);
}

static int nimi_macos_keychain_find(nimi_macos_keychain_store *store,
                                    const char *service, const char *account,
                                    UInt32 *length, void **data,
                                    SecKeychainItemRef *item) {
    if (store == NULL || service == NULL || account == NULL || length == NULL || data == NULL || item == NULL) {
        return EINVAL;
    }
    *length = 0;
    *data = NULL;
    *item = NULL;
    OSStatus status = SecKeychainFindGenericPassword(
        store->keychain,
        (UInt32)strlen(service), service,
        (UInt32)strlen(account), account,
        length, data, item);
    if (status != errSecSuccess) {
        return (int)status;
    }
    int access_status = nimi_macos_keychain_validate_access(store, *item);
    if (access_status != 0) {
        if (*data != NULL) SecKeychainItemFreeContent(NULL, *data);
        if (*item != NULL) CFRelease(*item);
        *data = NULL;
        *item = NULL;
        *length = 0;
        return access_status;
    }
    return 0;
}

static int nimi_macos_keychain_load(nimi_macos_keychain_store *store,
                                    const char *service, const char *account,
                                    unsigned char **output, size_t *output_length) {
    if (output == NULL || output_length == NULL) return EINVAL;
    *output = NULL;
    *output_length = 0;
    UInt32 length = 0;
    void *data = NULL;
    SecKeychainItemRef item = NULL;
    int result = nimi_macos_keychain_find(store, service, account, &length, &data, &item);
    if (result != 0) return result;
    if (length == 0 || length > 65536 || data == NULL) {
        result = EINVAL;
    } else {
        unsigned char *copy = malloc(length);
        if (copy == NULL) {
            result = ENOMEM;
        } else {
            memcpy(copy, data, length);
            *output = copy;
            *output_length = length;
        }
    }
    if (data != NULL) SecKeychainItemFreeContent(NULL, data);
    if (item != NULL) CFRelease(item);
    return result;
}

static int nimi_macos_keychain_create(nimi_macos_keychain_store *store,
                                      const char *service, const char *account,
                                      const unsigned char *data, size_t data_length) {
    SecKeychainAttribute attributes[2];
    memset(attributes, 0, sizeof(attributes));
    attributes[0].tag = kSecServiceItemAttr;
    attributes[0].length = (UInt32)strlen(service);
    attributes[0].data = (void *)service;
    attributes[1].tag = kSecAccountItemAttr;
    attributes[1].length = (UInt32)strlen(account);
    attributes[1].data = (void *)account;
    SecKeychainAttributeList list = {2, attributes};
    SecKeychainItemRef item = NULL;
    OSStatus status = SecKeychainItemCreateFromContent(
        kSecGenericPasswordItemClass, &list, (UInt32)data_length, data,
        store->keychain, store->access, &item);
    if (status != errSecSuccess || item == NULL) {
        if (item != NULL) CFRelease(item);
        return status == errSecSuccess ? EIO : (int)status;
    }
    int result = nimi_macos_keychain_validate_access(store, item);
    CFRelease(item);
    return result;
}

static int nimi_macos_keychain_write(nimi_macos_keychain_store *store,
                                     const char *service, const char *account,
                                     const unsigned char *data, size_t data_length) {
    if (store == NULL || service == NULL || account == NULL || data == NULL ||
        data_length == 0 || data_length > 65536) {
        return EINVAL;
    }
    UInt32 existing_length = 0;
    void *existing_data = NULL;
    SecKeychainItemRef item = NULL;
    int result = nimi_macos_keychain_find(store, service, account, &existing_length, &existing_data, &item);
    if (result == errSecItemNotFound) {
        return nimi_macos_keychain_create(store, service, account, data, data_length);
    }
    if (result != 0) return result;
    if (existing_data != NULL) SecKeychainItemFreeContent(NULL, existing_data);
    OSStatus status = SecKeychainItemModifyAttributesAndData(item, NULL, (UInt32)data_length, data);
    if (status == errSecSuccess) {
        result = nimi_macos_keychain_validate_access(store, item);
    } else {
        result = (int)status;
    }
    CFRelease(item);
    return result;
}

static int nimi_macos_keychain_delete(nimi_macos_keychain_store *store,
                                      const char *service, const char *account) {
    UInt32 length = 0;
    void *data = NULL;
    SecKeychainItemRef item = NULL;
    int result = nimi_macos_keychain_find(store, service, account, &length, &data, &item);
    if (result != 0) return result;
    if (data != NULL) SecKeychainItemFreeContent(NULL, data);
    OSStatus status = SecKeychainItemDelete(item);
    CFRelease(item);
    return status == errSecSuccess ? 0 : (int)status;
}
*/
import "C"

import (
	"context"
	"fmt"
	"regexp"
	"runtime"
	"sync"
	"unsafe"
)

var macOSSecretNamePattern = regexp.MustCompile(`^[a-z][a-z0-9.-]{0,62}[a-z0-9]$|^[a-z]$`)

type macOSSystemKeychainSecretStore struct {
	native    *C.nimi_macos_keychain_store
	mu        sync.Mutex
	closed    bool
	closeOnce sync.Once
}

func OpenMacOSSystemKeychainSecretStore() (*macOSSystemKeychainSecretStore, error) {
	if _, err := validateMacOSExecutablePath(MacOSRuntimeExecutablePath, MacOSRuntimeExecutablePath); err != nil {
		return nil, fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "repair_runtime_service", err)
	}
	runtimePath := C.CString(MacOSRuntimeExecutablePath)
	defer C.free(unsafe.Pointer(runtimePath))
	var native *C.nimi_macos_keychain_store
	if result := C.nimi_macos_keychain_open(runtimePath, &native); result != 0 || native == nil {
		return nil, fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "repair_runtime_service", fmt.Errorf("open Runtime-only System Keychain custody: native status %d", int(result)))
	}
	store := &macOSSystemKeychainSecretStore{native: native}
	runtime.SetFinalizer(store, func(leaked *macOSSystemKeychainSecretStore) { _ = leaked.Close() })
	return store, nil
}

func (store *macOSSystemKeychainSecretStore) withNative(operation string, fn func(*C.nimi_macos_keychain_store) error) error {
	if store == nil {
		return fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "repair_runtime_service", fmt.Errorf("%s: System Keychain store is required", operation))
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.closed || store.native == nil {
		return fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "repair_runtime_service", fmt.Errorf("%s: System Keychain store is closed", operation))
	}
	return fn(store.native)
}

func macOSSecretName(name string) (*C.char, error) {
	if !macOSSecretNamePattern.MatchString(name) {
		return nil, fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "repair_runtime_service", fmt.Errorf("invalid Runtime Keychain item name"))
	}
	return C.CString(name), nil
}

func (store *macOSSystemKeychainSecretStore) Load(ctx context.Context, name string) ([]byte, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	account, err := macOSSecretName(name)
	if err != nil {
		return nil, err
	}
	defer C.free(unsafe.Pointer(account))
	service := C.CString(MacOSKeychainService)
	defer C.free(unsafe.Pointer(service))
	var value []byte
	err = store.withNative("load Runtime System Keychain item", func(native *C.nimi_macos_keychain_store) error {
		var output *C.uchar
		var length C.size_t
		result := C.nimi_macos_keychain_load(native, service, account, &output, &length)
		if result == C.errSecItemNotFound {
			return ErrProtectedSecretNotFound
		}
		if result != 0 || output == nil || length == 0 {
			return fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "repair_runtime_service", fmt.Errorf("load Runtime System Keychain item: native status %d", int(result)))
		}
		defer C.free(unsafe.Pointer(output))
		value = C.GoBytes(unsafe.Pointer(output), C.int(length))
		return nil
	})
	return value, err
}

func (store *macOSSystemKeychainSecretStore) Store(ctx context.Context, name string, value []byte) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if len(value) == 0 || len(value) > 65536 {
		return fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "repair_runtime_service", fmt.Errorf("invalid Runtime System Keychain item size"))
	}
	account, err := macOSSecretName(name)
	if err != nil {
		return err
	}
	defer C.free(unsafe.Pointer(account))
	service := C.CString(MacOSKeychainService)
	defer C.free(unsafe.Pointer(service))
	copyValue := append([]byte(nil), value...)
	defer zeroBytes(copyValue)
	return store.withNative("store Runtime System Keychain item", func(native *C.nimi_macos_keychain_store) error {
		result := C.nimi_macos_keychain_write(native, service, account, (*C.uchar)(unsafe.Pointer(&copyValue[0])), C.size_t(len(copyValue)))
		if result != 0 {
			return fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "repair_runtime_service", fmt.Errorf("store Runtime System Keychain item: native status %d", int(result)))
		}
		return nil
	})
}

func (store *macOSSystemKeychainSecretStore) Delete(ctx context.Context, name string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	account, err := macOSSecretName(name)
	if err != nil {
		return err
	}
	defer C.free(unsafe.Pointer(account))
	service := C.CString(MacOSKeychainService)
	defer C.free(unsafe.Pointer(service))
	return store.withNative("delete Runtime System Keychain item", func(native *C.nimi_macos_keychain_store) error {
		result := C.nimi_macos_keychain_delete(native, service, account)
		if result == C.errSecItemNotFound {
			return ErrProtectedSecretNotFound
		}
		if result != 0 {
			return fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "repair_runtime_service", fmt.Errorf("delete Runtime System Keychain item: native status %d", int(result)))
		}
		return nil
	})
}

func (store *macOSSystemKeychainSecretStore) Close() error {
	if store == nil {
		return nil
	}
	store.closeOnce.Do(func() {
		store.mu.Lock()
		store.closed = true
		native := store.native
		store.native = nil
		store.mu.Unlock()
		if native != nil {
			C.nimi_macos_keychain_close(native)
		}
		runtime.SetFinalizer(store, nil)
	})
	return nil
}

var _ BinarySecretStore = (*macOSSystemKeychainSecretStore)(nil)
