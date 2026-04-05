use super::{validate_observation_selection, JournalTagInput};

#[test]
fn rejects_unknown_dimension_id() {
    let result = validate_observation_selection(Some("PO-OBS-UNKNOWN"), None, &[]);
    assert!(result
        .expect_err("expected unknown dimensionId to fail")
        .contains("unsupported journal observation dimensionId"));
}

#[test]
fn rejects_tags_without_dimension_id() {
    let result = validate_observation_selection(None, Some("[\"Deep focus\"]"), &[]);
    assert!(result
        .expect_err("expected tags without dimensionId to fail")
        .contains("require a dimensionId"));
}

#[test]
fn rejects_ai_tags_outside_the_dimension_quick_tag_set() {
    let ai_tags = vec![JournalTagInput {
        tag_id: "tag-1".to_string(),
        domain: "observation".to_string(),
        tag: "Invented tag".to_string(),
        source: "ai".to_string(),
        confidence: Some(0.6),
    }];

    let result = validate_observation_selection(
        Some("PO-OBS-CONC-001"),
        Some("[\"深度专注\"]"),
        &ai_tags,
    );

    assert!(result
        .expect_err("expected unsupported AI tag to fail")
        .contains("unsupported journal AI tag"));
}

#[test]
fn accepts_supported_dimension_and_tags() {
    let ai_tags = vec![JournalTagInput {
        tag_id: "tag-1".to_string(),
        domain: "observation".to_string(),
        tag: "深度专注".to_string(),
        source: "ai".to_string(),
        confidence: Some(0.8),
    }];

    validate_observation_selection(
        Some("PO-OBS-CONC-001"),
        Some("[\"深度专注\",\"反复操作\"]"),
        &ai_tags,
    )
    .expect("expected supported tags to pass");
}
