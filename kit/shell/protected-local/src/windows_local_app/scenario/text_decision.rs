use super::*;
use crate::generated::text_decision_answer::Result as DecisionAnswer;
use crate::generated::text_decision_content::Value as DecisionContent;
use crate::generated::text_decision_question::Kind as DecisionKind;
use crate::generated::{
    TextDecideScenarioSpec, TextDecisionBoolean, TextDecisionCandidate, TextDecisionChoice,
    TextDecisionContent, TextDecisionQuestion, TextDecisionResult,
};
use prost::Message;
use serde::de::{self, DeserializeSeed, Deserializer, MapAccess, SeqAccess, Visitor};
use std::collections::HashSet;
use std::fmt;

// Public text.decide bounds mirrored from Runtime. Encoding limits of the
// captured implementation stay Runtime-owned (AI_INPUT_LIMIT_EXCEEDED).
const MAX_STATE_BYTES: usize = 256 * 1024;
const MAX_QUESTIONS: usize = 64;
const MAX_INSTRUCTION_BYTES: usize = 32 * 1024;
const MAX_CRITERION_BYTES: usize = 8 * 1024;
const MIN_CANDIDATES: usize = 2;
const MAX_CANDIDATES: usize = 255;
const MAX_ID_BYTES: usize = 64;
const MAX_REQUEST_BYTES: usize = 1024 * 1024;
const MAX_JSON_DEPTH: usize = 64;
const PROBABILITY_SUM_TOLERANCE: f64 = 0.02;
/// A binary64 sum of decimal probabilities that is exactly 0.98 or 1.02 lands a
/// few ulps past the bound; this absorbs only that rounding.
const PROBABILITY_SUM_EPSILON: f64 = 1e-9;
const ARGMAX_TOLERANCE: f64 = 1e-6;

// @nimi-authority: rule.nimi.runtime.ai-provider.text-decision
/// Parses the exact carrier spec. JSON content stays the caller's text and is
/// carried without re-serialization, so key order and spelling are preserved.
pub(super) fn parse(
    object: &Map<String, JsonValue>,
) -> Result<TextDecideScenarioSpec, LocalAppOperationError> {
    exact_keys(object, &["type", "state", "questions"])?;
    let state = content(field(object, "state")?, MAX_STATE_BYTES)?;
    let values = field(object, "questions")?
        .as_array()
        .ok_or_else(invalid_payload)?;
    if values.is_empty() || values.len() > MAX_QUESTIONS {
        return Err(invalid_payload());
    }
    let mut question_ids = HashSet::new();
    let mut questions = Vec::with_capacity(values.len());
    for value in values {
        let question = value.as_object().ok_or_else(invalid_payload)?;
        let id = decision_id(field(question, "id")?)?;
        if !question_ids.insert(id.clone()) {
            return Err(invalid_payload());
        }
        let kind = match string_field(question, "kind")? {
            "choice" => {
                exact_keys(question, &["id", "instructions", "kind", "candidates"])?;
                DecisionKind::Choice(choice(field(question, "candidates")?)?)
            }
            "boolean" => {
                allowed_keys(
                    question,
                    &["id", "instructions", "kind", "trueCriterion", "falseCriterion"],
                    &["id", "instructions", "kind"],
                )?;
                DecisionKind::Boolean(TextDecisionBoolean {
                    true_criterion: optional_content(question, "trueCriterion")?,
                    false_criterion: optional_content(question, "falseCriterion")?,
                })
            }
            _ => return Err(invalid_payload()),
        };
        questions.push(TextDecisionQuestion {
            id,
            instructions: Some(content(field(question, "instructions")?, MAX_INSTRUCTION_BYTES)?),
            kind: Some(kind),
        });
    }
    let spec = TextDecideScenarioSpec {
        state: Some(state),
        questions,
    };
    if spec.encoded_len() > MAX_REQUEST_BYTES {
        return Err(invalid_payload());
    }
    Ok(spec)
}

// @nimi-authority: rule.nimi.runtime.ai-provider.text-decision
/// Projects exactly one answer per submitted question in submitted order with
/// one finite probability per submitted candidate; anything else is a typed
/// output failure that keeps the protected session.
pub(super) fn project(
    spec: &TextDecideScenarioSpec,
    result: TextDecisionResult,
) -> Result<JsonValue, LocalAppOperationError> {
    if result.answers.len() != spec.questions.len() {
        return Err(output_invalid());
    }
    let mut answers = Vec::with_capacity(result.answers.len());
    for (question, answer) in spec.questions.iter().zip(result.answers) {
        if answer.question_id != question.id {
            return Err(output_invalid());
        }
        match (question.kind.as_ref(), answer.result) {
            (Some(DecisionKind::Choice(choice)), Some(DecisionAnswer::Choice(value))) => {
                if value.probabilities.len() != choice.candidates.len() {
                    return Err(output_invalid());
                }
                let mut sum = 0.0_f64;
                let mut maximum = f64::NEG_INFINITY;
                let mut selected = None;
                let mut probabilities = Vec::with_capacity(choice.candidates.len());
                for (candidate, entry) in choice.candidates.iter().zip(value.probabilities) {
                    if entry.candidate_id != candidate.id || !valid_probability(entry.probability) {
                        return Err(output_invalid());
                    }
                    sum += entry.probability;
                    maximum = maximum.max(entry.probability);
                    if entry.candidate_id == value.selected_candidate_id {
                        selected = Some(entry.probability);
                    }
                    probabilities.push(json!({
                        "candidateId": entry.candidate_id,
                        "probability": entry.probability,
                    }));
                }
                let selected = selected.ok_or_else(output_invalid)?;
                if (sum - 1.0).abs() > PROBABILITY_SUM_TOLERANCE + PROBABILITY_SUM_EPSILON
                    || selected < maximum - ARGMAX_TOLERANCE
                {
                    return Err(output_invalid());
                }
                answers.push(json!({
                    "questionId": question.id,
                    "kind": "choice",
                    "selectedCandidateId": value.selected_candidate_id,
                    "probabilities": probabilities,
                }));
            }
            (Some(DecisionKind::Boolean(_)), Some(DecisionAnswer::Boolean(value))) => {
                if !valid_probability(value.true_probability) {
                    return Err(output_invalid());
                }
                answers.push(json!({
                    "questionId": question.id,
                    "kind": "boolean",
                    "trueProbability": value.true_probability,
                }));
            }
            _ => return Err(output_invalid()),
        }
    }
    Ok(json!({ "type": "text-decide", "answers": answers }))
}

/// A result that does not answer the submitted questions: typed
/// ai-output-invalid, which leaves the protected session valid.
pub(super) fn output_invalid() -> LocalAppOperationError {
    LocalAppOperationError::new(LocalAppReasonCode::AiOutputInvalid, false)
}

fn choice(value: &JsonValue) -> Result<TextDecisionChoice, LocalAppOperationError> {
    let entries = value.as_array().ok_or_else(invalid_payload)?;
    if entries.len() < MIN_CANDIDATES || entries.len() > MAX_CANDIDATES {
        return Err(invalid_payload());
    }
    let mut ids = HashSet::new();
    let mut candidates = Vec::with_capacity(entries.len());
    for entry in entries {
        let candidate = entry.as_object().ok_or_else(invalid_payload)?;
        allowed_keys(candidate, &["id", "description"], &["id"])?;
        let id = decision_id(field(candidate, "id")?)?;
        if !ids.insert(id.clone()) {
            return Err(invalid_payload());
        }
        candidates.push(TextDecisionCandidate {
            id,
            description: optional_content(candidate, "description")?,
        });
    }
    Ok(TextDecisionChoice { candidates })
}

fn optional_content(
    object: &Map<String, JsonValue>,
    key: &str,
) -> Result<Option<TextDecisionContent>, LocalAppOperationError> {
    object
        .get(key)
        .map(|value| content(value, MAX_CRITERION_BYTES))
        .transpose()
}

fn content(value: &JsonValue, maximum: usize) -> Result<TextDecisionContent, LocalAppOperationError> {
    let object = value.as_object().ok_or_else(invalid_payload)?;
    if object.len() != 1 {
        return Err(invalid_payload());
    }
    let value = if let Some(text) = object.get("text") {
        let text = text.as_str().ok_or_else(invalid_payload)?;
        // Runtime admits any nonblank Unicode text without NUL.
        if text.is_empty() || text.len() > maximum || text.contains('\0') || text.trim().is_empty() {
            return Err(invalid_payload());
        }
        DecisionContent::Text(text.to_string())
    } else if let Some(json) = object.get("json") {
        let json = json.as_str().ok_or_else(invalid_payload)?;
        if json.is_empty() || json.len() > maximum || !strict_json_container(json) {
            return Err(invalid_payload());
        }
        DecisionContent::Json(json.to_string())
    } else {
        return Err(invalid_payload());
    };
    Ok(TextDecisionContent { value: Some(value) })
}

fn decision_id(value: &JsonValue) -> Result<String, LocalAppOperationError> {
    let id = value.as_str().ok_or_else(invalid_payload)?;
    if id.is_empty()
        || id.len() > MAX_ID_BYTES
        || id.trim() != id
        || id.chars().any(|character| character.is_control() || character == '\u{FFFD}')
    {
        return Err(invalid_payload());
    }
    Ok(id.to_string())
}

fn valid_probability(value: f64) -> bool {
    value.is_finite() && (0.0..=1.0).contains(&value)
}

/// One JSON object or array with unique keys and at most 64 nested containers.
fn strict_json_container(text: &str) -> bool {
    let body = text.trim_start_matches([' ', '\t', '\n', '\r']);
    if !body.starts_with('{') && !body.starts_with('[') {
        return false;
    }
    let mut deserializer = serde_json::Deserializer::from_str(text);
    StrictJson { depth: 1 }.deserialize(&mut deserializer).is_ok() && deserializer.end().is_ok()
}

struct StrictJson {
    depth: usize,
}

impl<'de> DeserializeSeed<'de> for StrictJson {
    type Value = ();

    fn deserialize<D: Deserializer<'de>>(self, deserializer: D) -> Result<(), D::Error> {
        deserializer.deserialize_any(self)
    }
}

impl<'de> Visitor<'de> for StrictJson {
    type Value = ();

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("strict JSON")
    }

    fn visit_bool<E: de::Error>(self, _value: bool) -> Result<(), E> {
        Ok(())
    }

    fn visit_i64<E: de::Error>(self, _value: i64) -> Result<(), E> {
        Ok(())
    }

    fn visit_u64<E: de::Error>(self, _value: u64) -> Result<(), E> {
        Ok(())
    }

    fn visit_f64<E: de::Error>(self, _value: f64) -> Result<(), E> {
        Ok(())
    }

    fn visit_str<E: de::Error>(self, _value: &str) -> Result<(), E> {
        Ok(())
    }

    fn visit_unit<E: de::Error>(self) -> Result<(), E> {
        Ok(())
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut sequence: A) -> Result<(), A::Error> {
        if self.depth > MAX_JSON_DEPTH {
            return Err(de::Error::custom("text decision JSON nesting exceeds the bound"));
        }
        while sequence
            .next_element_seed(StrictJson {
                depth: self.depth + 1,
            })?
            .is_some()
        {}
        Ok(())
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<(), A::Error> {
        if self.depth > MAX_JSON_DEPTH {
            return Err(de::Error::custom("text decision JSON nesting exceeds the bound"));
        }
        let mut keys = HashSet::new();
        while let Some(key) = map.next_key::<String>()? {
            if !keys.insert(key) {
                return Err(de::Error::custom("text decision JSON repeats an object key"));
            }
            map.next_value_seed(StrictJson {
                depth: self.depth + 1,
            })?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::generated::{
        TextDecisionAnswer, TextDecisionBooleanAnswer, TextDecisionCandidateProbability,
        TextDecisionChoiceAnswer,
    };

    fn spec_json() -> JsonValue {
        json!({
            "type": "text-decide",
            "state": { "json": "{\"b\":1,\"a\":[1.5,\"x\"],\"token\":\"rook\"}" },
            "questions": [
                {
                    "id": "move",
                    "instructions": { "text": "Pick the move." },
                    "kind": "choice",
                    "candidates": [
                        { "id": "a1" },
                        { "id": "h8", "description": { "json": "{\"corner\":true}" } },
                    ],
                },
                {
                    "id": "resign",
                    "instructions": { "json": "[\"Resign?\"]" },
                    "kind": "boolean",
                    "falseCriterion": { "text": "Play on." },
                },
            ],
        })
    }

    fn parsed() -> TextDecideScenarioSpec {
        parse(spec_json().as_object().expect("object")).expect("valid text decision")
    }

    fn choice_answer(selected: &str, probabilities: &[(&str, f64)]) -> TextDecisionAnswer {
        TextDecisionAnswer {
            question_id: "move".to_string(),
            result: Some(DecisionAnswer::Choice(TextDecisionChoiceAnswer {
                selected_candidate_id: selected.to_string(),
                probabilities: probabilities
                    .iter()
                    .map(|(candidate_id, probability)| TextDecisionCandidateProbability {
                        candidate_id: candidate_id.to_string(),
                        probability: *probability,
                    })
                    .collect(),
            })),
        }
    }

    fn boolean_answer(probability: f64) -> TextDecisionAnswer {
        TextDecisionAnswer {
            question_id: "resign".to_string(),
            result: Some(DecisionAnswer::Boolean(TextDecisionBooleanAnswer {
                true_probability: probability,
            })),
        }
    }

    #[test]
    fn text_decision_spec_keeps_order_and_json_text_verbatim() {
        let spec = parsed();
        assert_eq!(
            spec.state,
            Some(TextDecisionContent {
                value: Some(DecisionContent::Json(
                    "{\"b\":1,\"a\":[1.5,\"x\"],\"token\":\"rook\"}".to_string()
                )),
            })
        );
        assert_eq!(spec.questions[0].id, "move");
        let Some(DecisionKind::Choice(choice)) = spec.questions[0].kind.as_ref() else {
            panic!("choice question");
        };
        assert_eq!(
            choice
                .candidates
                .iter()
                .map(|candidate| candidate.id.as_str())
                .collect::<Vec<_>>(),
            ["a1", "h8"]
        );
        assert!(choice.candidates[0].description.is_none());
        let Some(DecisionKind::Boolean(boolean)) = spec.questions[1].kind.as_ref() else {
            panic!("boolean question");
        };
        assert!(boolean.true_criterion.is_none());
        assert!(boolean.false_criterion.is_some());
        assert!(parse_execute_spec(spec_json()).is_ok());
    }

    #[test]
    fn text_decision_spec_rejects_unbounded_or_ambiguous_input_before_transport() {
        let mut deep = String::new();
        for _ in 0..65 {
            deep.push('[');
        }
        for _ in 0..65 {
            deep.push(']');
        }
        let mut accepted_depth = String::new();
        for _ in 0..64 {
            accepted_depth.push('[');
        }
        for _ in 0..64 {
            accepted_depth.push(']');
        }
        assert!(strict_json_container(&accepted_depth));
        assert!(!strict_json_container(&deep));
        for json in [
            "{\"a\":1,\"a\":2}",
            "\"text\"",
            "null",
            "{\"a\":\"\\ud800\"}",
            "{",
            "{} []",
            "",
        ] {
            assert!(!strict_json_container(json), "{json}");
        }
        assert!(strict_json_container(" {\"a\": 1}\n"));

        let mutate = |edit: &dyn Fn(&mut JsonValue)| {
            let mut value = spec_json();
            edit(&mut value);
            parse_execute_spec(value).is_err()
        };
        assert!(mutate(&|value| {
            value["extra"] = json!(true);
        }));
        assert!(mutate(&|value| {
            value["state"] = json!({ "text": " \u{3000}\t" });
        }));
        assert!(mutate(&|value| {
            value["state"] = json!({ "text": "x", "json": "{}" });
        }));
        assert!(mutate(&|value| {
            value["state"] = json!({ "json": { "a": 1 } });
        }));
        assert!(mutate(&|value| {
            value["state"] = json!({ "text": "x".repeat(MAX_STATE_BYTES + 1) });
        }));
        assert!(mutate(&|value| {
            value["questions"] = json!([]);
        }));
        assert!(mutate(&|value| {
            let first = value["questions"][0].clone();
            value["questions"] = json!([first.clone(), first]);
        }));
        assert!(mutate(&|value| {
            value["questions"][0]["candidates"] = json!([{ "id": "only" }]);
        }));
        assert!(mutate(&|value| {
            value["questions"][0]["candidates"] = json!([{ "id": "same" }, { "id": "same" }]);
        }));
        assert!(mutate(&|value| {
            value["questions"][0]["id"] = json!(" padded");
        }));
        assert!(mutate(&|value| {
            value["questions"][0]["id"] = json!("x".repeat(MAX_ID_BYTES + 1));
        }));
        assert!(mutate(&|value| {
            value["questions"][0]["id"] = json!("tab\tinside");
        }));
        assert!(mutate(&|value| {
            value["questions"][0]["id"] = json!("replacement\u{FFFD}");
        }));
        assert!(mutate(&|value| {
            value["questions"][0]["modelId"] = json!("forbidden");
        }));
        assert!(mutate(&|value| {
            value["questions"][1]["candidates"] = json!([]);
        }));
        assert!(mutate(&|value| {
            value["questions"][1]["trueCriterion"] = JsonValue::Null;
        }));
        assert!(mutate(&|value| {
            value["questions"] = JsonValue::Array(
                (0..40)
                    .map(|index| {
                        json!({
                            "id": format!("q{index}"),
                            "instructions": { "text": "x".repeat(30 * 1024) },
                            "kind": "boolean",
                        })
                    })
                    .collect(),
            );
        }));
    }

    #[test]
    fn text_decision_projection_requires_exact_answers() {
        let spec = parsed();
        let projected = project(
            &spec,
            TextDecisionResult {
                answers: vec![
                    choice_answer("h8", &[("a1", 0.3), ("h8", 0.7)]),
                    boolean_answer(0.25),
                ],
            },
        )
        .expect("valid decision");
        assert_eq!(
            projected,
            json!({
                "type": "text-decide",
                "answers": [
                    {
                        "questionId": "move",
                        "kind": "choice",
                        "selectedCandidateId": "h8",
                        "probabilities": [
                            { "candidateId": "a1", "probability": 0.3 },
                            { "candidateId": "h8", "probability": 0.7 },
                        ],
                    },
                    { "questionId": "resign", "kind": "boolean", "trueProbability": 0.25 },
                ],
            })
        );
        // Sums of exactly 0.98 and 1.02 are inside the tolerance; 0.97 and 1.03 are not.
        for (probabilities, valid) in [
            ([("a1", 0.49), ("h8", 0.49)], true),
            ([("a1", 0.51), ("h8", 0.51)], true),
            ([("a1", 0.48), ("h8", 0.49)], false),
            ([("a1", 0.51), ("h8", 0.52)], false),
        ] {
            let projected = project(
                &spec,
                TextDecisionResult { answers: vec![choice_answer("h8", &probabilities), boolean_answer(0.25)] },
            );
            assert_eq!(projected.is_ok(), valid, "{probabilities:?}");
        }
        // Ties at the maximum are admitted.
        assert!(project(
            &spec,
            TextDecisionResult {
                answers: vec![choice_answer("a1", &[("a1", 0.5), ("h8", 0.5)]), boolean_answer(1.0)],
            },
        )
        .is_ok());
        for answers in [
            vec![choice_answer("h8", &[("a1", 0.3), ("h8", 0.7)])],
            vec![boolean_answer(0.25), choice_answer("h8", &[("a1", 0.3), ("h8", 0.7)])],
            vec![choice_answer("h8", &[("h8", 0.7), ("a1", 0.3)]), boolean_answer(0.25)],
            vec![choice_answer("a1", &[("a1", 0.3), ("h8", 0.7)]), boolean_answer(0.25)],
            vec![choice_answer("zz", &[("a1", 0.3), ("h8", 0.7)]), boolean_answer(0.25)],
            vec![choice_answer("h8", &[("a1", 0.5), ("h8", 0.7)]), boolean_answer(0.25)],
            vec![choice_answer("h8", &[("a1", -0.1), ("h8", 1.1)]), boolean_answer(0.25)],
            vec![choice_answer("h8", &[("a1", 0.3), ("h8", 0.7)]), boolean_answer(f64::NAN)],
            vec![choice_answer("h8", &[("a1", 0.3), ("h8", 0.7)]), boolean_answer(1.5)],
            vec![
                choice_answer("h8", &[("a1", 0.3), ("h8", 0.7)]),
                boolean_answer(0.25),
                boolean_answer(0.25),
            ],
            vec![
                choice_answer("h8", &[("a1", 0.3), ("h8", 0.7)]),
                TextDecisionAnswer {
                    question_id: "resign".to_string(),
                    result: None,
                },
            ],
        ] {
            assert_eq!(
                project(&spec, TextDecisionResult { answers })
                    .expect_err("inconsistent decision")
                    .reason_code(),
                LocalAppReasonCode::AiOutputInvalid
            );
        }
    }
}
