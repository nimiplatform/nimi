package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func setCmdTestHome(t *testing.T, homeDir string) {
	t.Helper()
	t.Setenv("HOME", homeDir)
	t.Setenv("USERPROFILE", homeDir)

	volume := filepath.VolumeName(homeDir)
	if volume == "" {
		volume = "C:"
	}
	homePath := strings.TrimPrefix(homeDir, volume)
	if homePath == "" {
		homePath = string(os.PathSeparator)
	}

	t.Setenv("HOMEDRIVE", volume)
	t.Setenv("HOMEPATH", homePath)
}
