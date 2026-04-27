# Topic Runner Gating

`nimicoding topic-runner` may continue across a topic lifecycle transition when
the transition is mechanically determined by existing topic authority.

`stop_class: continue` means the emitted `next_command_ref` is concrete,
placeholder-free, package-owned, and safe for the runner to execute without a
manager judgement. It does not mean the command is limited to non-mutating
dispatch work.

The runner may use `continue` for these selected-target operations:

- `admit_wave` when the selected wave is unique and admission validation passes.
- `freeze_packet` when exactly one complete freezeable draft packet in the topic
  root matches the selected wave.
- `dispatch_worker` or `dispatch_audit` when a dispatchable packet already
  exists.

The runner must use `require_human_confirmation` when the next action requires
choosing among alternatives, resolving ambiguous or missing inputs, approving
closeout, continuing overflow, or making any manager-owned judgement.

The runner must use `await_external_evidence` when progress depends on worker,
audit, or result evidence that does not yet exist.
