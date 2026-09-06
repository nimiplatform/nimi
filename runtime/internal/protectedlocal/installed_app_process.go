package protectedlocal

// InstalledAppProcessPolicy comes only from Runtime's committed package
// verification and the current protected Desktop connection.
type InstalledAppProcessPolicy struct {
	RegistrationHandle    string
	SourceGeneration      uint64
	DeclarationGeneration uint64
	HostExecutablePath    string
	HostExecutableDigest  Identifier
	ExecutionProfileRef   string
	SupervisorProcess     ProcessTuple
}

func (policy InstalledAppProcessPolicy) valid() bool {
	return policy.RegistrationHandle != "" && policy.SourceGeneration != 0 && policy.DeclarationGeneration != 0 &&
		policy.HostExecutablePath != "" && policy.HostExecutableDigest != (Identifier{}) &&
		policy.ExecutionProfileRef == "windows-user-mode-as-invoker-v1" && policy.SupervisorProcess.validate() == nil && policy.SupervisorProcess.OS == OSWindows
}
