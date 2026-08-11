package filedownload

import "errors"

// ErrTransientAttemptsExhausted marks a network or body-stream failure that
// the download core classified as transient but could not recover within its
// bounded attempt budget. Callers may use this typed marker to offer a retry;
// diagnostic error text is never part of that decision.
var ErrTransientAttemptsExhausted = errors.New("filedownload: transient attempts exhausted")
