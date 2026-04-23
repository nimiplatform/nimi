use std::collections::HashMap;
use std::sync::Mutex;

use crate::avatar_launch_context::AvatarLaunchContext;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AvatarInstanceRegistryEntry {
    pub window_label: String,
    pub context: AvatarLaunchContext,
}

#[derive(Default)]
struct AvatarInstanceRegistryState {
    instance_to_label: HashMap<String, String>,
    label_to_context: HashMap<String, AvatarLaunchContext>,
}

#[derive(Default)]
pub struct AvatarInstanceRegistry {
    state: Mutex<AvatarInstanceRegistryState>,
}

impl AvatarInstanceRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn bind_window(
        &self,
        window_label: impl Into<String>,
        context: AvatarLaunchContext,
    ) -> Result<(), String> {
        let window_label = window_label.into();
        let mut guard = self
            .state
            .lock()
            .map_err(|_| "failed to lock avatar instance registry".to_string())?;
        if let Some(previous_context) = guard.label_to_context.get(&window_label) {
            let previous_instance_id = previous_context.avatar_instance_id.clone();
            guard.instance_to_label.remove(&previous_instance_id);
        }
        if let Some(previous_label) = guard
            .instance_to_label
            .insert(context.avatar_instance_id.clone(), window_label.clone())
        {
            if previous_label != window_label {
                guard.label_to_context.remove(&previous_label);
            }
        }
        guard.label_to_context.insert(window_label, context);
        Ok(())
    }

    pub fn window_label_for_instance(
        &self,
        avatar_instance_id: &str,
    ) -> Result<Option<String>, String> {
        self.state
            .lock()
            .map(|guard| guard.instance_to_label.get(avatar_instance_id).cloned())
            .map_err(|_| "failed to lock avatar instance registry".to_string())
    }

    pub fn context_for_window(
        &self,
        window_label: &str,
    ) -> Result<Option<AvatarLaunchContext>, String> {
        self.state
            .lock()
            .map(|guard| guard.label_to_context.get(window_label).cloned())
            .map_err(|_| "failed to lock avatar instance registry".to_string())
    }

    pub fn is_window_bound(&self, window_label: &str) -> Result<bool, String> {
        self.state
            .lock()
            .map(|guard| guard.label_to_context.contains_key(window_label))
            .map_err(|_| "failed to lock avatar instance registry".to_string())
    }

    pub fn remove_window(&self, window_label: &str) -> Result<(), String> {
        let mut guard = self
            .state
            .lock()
            .map_err(|_| "failed to lock avatar instance registry".to_string())?;
        if let Some(previous_context) = guard.label_to_context.remove(window_label) {
            guard
                .instance_to_label
                .remove(&previous_context.avatar_instance_id);
        }
        Ok(())
    }

    pub fn snapshot(&self) -> Result<Vec<AvatarInstanceRegistryEntry>, String> {
        self.state
            .lock()
            .map(|guard| {
                let mut entries = guard
                    .label_to_context
                    .iter()
                    .map(|(window_label, context)| AvatarInstanceRegistryEntry {
                        window_label: window_label.clone(),
                        context: context.clone(),
                    })
                    .collect::<Vec<_>>();
                entries.sort_by(|left, right| {
                    left.context
                        .avatar_instance_id
                        .cmp(&right.context.avatar_instance_id)
                        .then_with(|| left.window_label.cmp(&right.window_label))
                });
                entries
            })
            .map_err(|_| "failed to lock avatar instance registry".to_string())
    }
}

#[cfg(test)]
mod tests {
    use crate::avatar_launch_context::{AvatarAnchorMode, AvatarLaunchContext};

    use super::AvatarInstanceRegistry;

    fn sample_context(instance_id: &str, anchor_id: Option<&str>) -> AvatarLaunchContext {
        AvatarLaunchContext {
            agent_id: "agent-1".to_string(),
            avatar_instance_id: instance_id.to_string(),
            conversation_anchor_id: anchor_id.map(str::to_string),
            anchor_mode: if anchor_id.is_some() {
                AvatarAnchorMode::Existing
            } else {
                AvatarAnchorMode::OpenNew
            },
            launched_by: "desktop".to_string(),
            source_surface: Some("desktop-agent-chat".to_string()),
        }
    }

    #[test]
    fn registry_keeps_distinct_instances_separate() {
        let registry = AvatarInstanceRegistry::new();
        registry
            .bind_window("avatar", sample_context("instance-1", Some("anchor-1")))
            .expect("bind instance 1");
        registry
            .bind_window(
                "avatar-instance-2",
                sample_context("instance-2", Some("anchor-2")),
            )
            .expect("bind instance 2");

        assert_eq!(
            registry
                .window_label_for_instance("instance-1")
                .expect("instance 1 label")
                .as_deref(),
            Some("avatar")
        );
        assert_eq!(
            registry
                .window_label_for_instance("instance-2")
                .expect("instance 2 label")
                .as_deref(),
            Some("avatar-instance-2")
        );
    }

    #[test]
    fn registry_updates_same_instance_without_overwriting_other_windows() {
        let registry = AvatarInstanceRegistry::new();
        registry
            .bind_window("avatar", sample_context("instance-1", Some("anchor-1")))
            .expect("bind original");
        registry
            .bind_window(
                "avatar-instance-2",
                sample_context("instance-2", Some("anchor-2")),
            )
            .expect("bind other instance");

        registry
            .bind_window("avatar", sample_context("instance-1", Some("anchor-3")))
            .expect("rebind original");

        assert_eq!(
            registry
                .context_for_window("avatar")
                .expect("context for avatar")
                .and_then(|context| context.conversation_anchor_id),
            Some("anchor-3".to_string())
        );
        assert_eq!(
            registry
                .context_for_window("avatar-instance-2")
                .expect("context for second window")
                .and_then(|context| context.conversation_anchor_id),
            Some("anchor-2".to_string())
        );
    }

    #[test]
    fn registry_cleanup_removes_stale_window_bindings() {
        let registry = AvatarInstanceRegistry::new();
        registry
            .bind_window("avatar", sample_context("instance-1", Some("anchor-1")))
            .expect("bind original");

        registry.remove_window("avatar").expect("remove avatar");

        assert_eq!(
            registry
                .window_label_for_instance("instance-1")
                .expect("instance label"),
            None
        );
        assert_eq!(
            registry
                .context_for_window("avatar")
                .expect("window context"),
            None
        );
    }

    #[test]
    fn registry_snapshot_returns_sorted_window_entries() {
        let registry = AvatarInstanceRegistry::new();
        registry
            .bind_window(
                "avatar-instance-2",
                sample_context("instance-2", Some("anchor-2")),
            )
            .expect("bind second");
        registry
            .bind_window("avatar", sample_context("instance-1", Some("anchor-1")))
            .expect("bind first");

        let snapshot = registry.snapshot().expect("snapshot");

        assert_eq!(snapshot.len(), 2);
        assert_eq!(snapshot[0].context.avatar_instance_id, "instance-1");
        assert_eq!(snapshot[1].context.avatar_instance_id, "instance-2");
    }
}
