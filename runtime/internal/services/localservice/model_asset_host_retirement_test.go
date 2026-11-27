package localservice

import "testing"

type fakeVerificationInvalidatingHost struct {
	retiredIDs    []string
	invalidations int
}

func (h *fakeVerificationInvalidatingHost) RetireModelAsset(id string) (bool, error) {
	h.retiredIDs = append(h.retiredIDs, id)
	return true, nil
}

func (h *fakeVerificationInvalidatingHost) SetModelAssetCleanupCallback(func()) {}

func (h *fakeVerificationInvalidatingHost) InvalidateModelAssetVerification() {
	h.invalidations++
}

func TestManagedModelAssetMutationInvalidatesRegisteredHostVerification(t *testing.T) {
	svc := &Service{}
	host := &fakeVerificationInvalidatingHost{}
	svc.SetModelAssetHostRetirers(host)

	svc.lockModelAssetMutation()
	svc.modelAssetMutationMu.Unlock()

	if host.invalidations != 1 {
		t.Fatalf("host invalidations = %d, want 1", host.invalidations)
	}
}
