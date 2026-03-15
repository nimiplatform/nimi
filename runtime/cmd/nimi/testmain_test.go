package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestMain(m *testing.M) {
	tempHome, err := os.MkdirTemp("", "nimi-cmd-home-*")
	if err != nil {
		panic(err)
	}

	homeValue, homeSet := os.LookupEnv("HOME")
	userProfileValue, userProfileSet := os.LookupEnv("USERPROFILE")
	homeDriveValue, homeDriveSet := os.LookupEnv("HOMEDRIVE")
	homePathValue, homePathSet := os.LookupEnv("HOMEPATH")
	configValue, configSet := os.LookupEnv("NIMI_RUNTIME_CONFIG_PATH")

	if err := os.Setenv("HOME", tempHome); err != nil {
		panic(err)
	}
	if err := os.Setenv("USERPROFILE", tempHome); err != nil {
		panic(err)
	}
	volume := filepath.VolumeName(tempHome)
	if volume == "" {
		volume = "C:"
	}
	homePath := strings.TrimPrefix(tempHome, volume)
	if homePath == "" {
		homePath = string(os.PathSeparator)
	}
	if err := os.Setenv("HOMEDRIVE", volume); err != nil {
		panic(err)
	}
	if err := os.Setenv("HOMEPATH", homePath); err != nil {
		panic(err)
	}
	if err := os.Unsetenv("NIMI_RUNTIME_CONFIG_PATH"); err != nil {
		panic(err)
	}

	exitCode := m.Run()

	if homeSet {
		_ = os.Setenv("HOME", homeValue)
	} else {
		_ = os.Unsetenv("HOME")
	}
	if userProfileSet {
		_ = os.Setenv("USERPROFILE", userProfileValue)
	} else {
		_ = os.Unsetenv("USERPROFILE")
	}
	if homeDriveSet {
		_ = os.Setenv("HOMEDRIVE", homeDriveValue)
	} else {
		_ = os.Unsetenv("HOMEDRIVE")
	}
	if homePathSet {
		_ = os.Setenv("HOMEPATH", homePathValue)
	} else {
		_ = os.Unsetenv("HOMEPATH")
	}
	if configSet {
		_ = os.Setenv("NIMI_RUNTIME_CONFIG_PATH", configValue)
	} else {
		_ = os.Unsetenv("NIMI_RUNTIME_CONFIG_PATH")
	}
	_ = os.RemoveAll(tempHome)

	os.Exit(exitCode)
}
