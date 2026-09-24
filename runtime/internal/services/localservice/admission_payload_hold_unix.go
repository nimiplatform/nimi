//go:build unix

package localservice

import "os"

// openAdmissionPayloadHold holds nothing on Unix: advisory locks do not keep a
// writer out, and change times are not updated by every write through a shared
// writable mapping, so every admission hashes its payloads again.
func openAdmissionPayloadHold(string) (*os.File, modelFileIdentity, bool, error) {
	return nil, modelFileIdentity{}, false, nil
}

func heldPayloadIdentity(*os.File) (modelFileIdentity, bool) {
	return modelFileIdentity{}, false
}

func openVerificationFile(path string) (*os.File, error) {
	return os.Open(path)
}
