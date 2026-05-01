# Agent Script Contract Reference Appendices

This file carries the reference appendices for [`agent-script-contract.md`](agent-script-contract.md). It remains under `.nimi/spec/avatar/kernel/**` authority and does not introduce parallel semantic truth.

## Appendix C: Embodiment Backend API v1 Cheatsheet

```typescript
// Motion
await projection.triggerMotion(id, { priority, loop, fadeIn, fadeOut });
projection.stopMotion();
// Signals / control channels
projection.setSignal(id, value, weight?);
const v = projection.getSignal(id);
projection.addSignal(id, delta);
// Expression
await projection.setExpression(id);
projection.clearExpression();
// Pose (durable)
projection.setPose(id, loop?);
projection.clearPose();
// Utility
await projection.wait(ms);
const bounds = projection.getSurfaceBounds();
```

## Appendix D: ctx quick reference

```typescript
ctx.activity?.{name, category, intensity, source}
ctx.posture.{posture_class, action_family, interrupt_mode, transition_reason, truth_basis_ids}
ctx.status_text
ctx.execution_state
ctx.active_world_id / active_user_id
ctx.history?.{last_activity, last_motion, last_expression}   // opt-in
ctx.event?.{event_name, event_id, timestamp, detail}
ctx.app.{namespace, surface_id, visible, focused, window, cursor_x, cursor_y}
ctx.runtime.{now, session_id, locale}
```
