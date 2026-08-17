//go:build !windows && !unix

package localservice

import "os"

type modelAssetSourceFileIdentity struct{}

func preflightModelAssetSourceFile(path string, _ os.FileInfo) (modelAssetSourceFileIdentity, error) {
	return modelAssetSourceFileIdentity{}, &modelAssetSourceSafetyError{Path: path, Reason: "platform does not support no-follow source handles"}
}

func openVerifiedModelAssetSourceFile(path string, _ modelAssetSourceFileIdentity) (*os.File, error) {
	return nil, &modelAssetSourceSafetyError{Path: path, Reason: "platform does not support no-follow source handles"}
}
