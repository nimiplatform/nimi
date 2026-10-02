import tempfile
import unittest
from pathlib import Path

from spacy_text_annotation import AnnotationError, AnnotationWorker, load_pipeline, validate_input


class AnnotationBoundaryTests(unittest.TestCase):
    def test_input_limits_use_utf8_bytes_and_allow_empty_documents(self):
        validate_input("en", ["", "  \n", "😀"])
        for texts in ([], [""] * 65, ["中" * 174763], ["\ud800"], [1]):
            with self.subTest(texts_type=type(texts)):
                with self.assertRaises(AnnotationError) as raised:
                    validate_input("en", texts)
                self.assertEqual(raised.exception.reason, "AI_INPUT_INVALID")

    def test_unknown_language_fails_before_model_loading(self):
        with self.assertRaises(AnnotationError) as raised:
            AnnotationWorker().run("/unavailable", "content", "xx", ["text"])
        self.assertEqual(raised.exception.reason, "AI_INPUT_INVALID")

    def test_curated_transformer_group_admits_only_its_three_exact_languages(self):
        for language in ("en", "de", "zh"):
            validate_input(language, ["", "😀"], "curated-trf")
        for language in ("fr", "ja", "es", "auto"):
            with self.assertRaises(AnnotationError) as raised:
                AnnotationWorker("curated-trf").run("/unavailable", "content", language, ["text"])
            self.assertEqual(raised.exception.reason, "AI_INPUT_INVALID")

    def test_same_configuration_does_not_admit_an_old_transformer_version(self):
        fixtures = Path(__file__).resolve().parents[2] / "capabilitydriver" / "testdata" / "spacy-curated-trf"
        for language, name in (("de", "dep_news_trf"), ("zh", "core_web_trf")):
            with tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                (root / "config.cfg").write_bytes((fixtures / language / "config.cfg").read_bytes())
                (root / "meta.json").write_text('{"lang":"' + language + '","name":"' + name + '","version":"3.7.2"}', encoding="utf-8")
                with self.assertRaises(AnnotationError) as raised:
                    load_pipeline(root, language, "curated-trf")
                self.assertEqual(raised.exception.reason, "AI_LOCAL_EXECUTION_LOAD_FAILED")

    def test_changed_configuration_is_rejected_before_spacy_import(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "config.cfg").write_text("[nlp]\nlang = en\n", encoding="utf-8")
            (root / "meta.json").write_text('{"lang":"en","name":"core_web_md","version":"3.8.0"}', encoding="utf-8")
            with self.assertRaises(AnnotationError) as raised:
                load_pipeline(root, "en")
            self.assertEqual(raised.exception.reason, "AI_LOCAL_EXECUTION_LOAD_FAILED")

    def test_model_identity_is_required(self):
        for root, identity in (("relative", "content"), (str(Path.cwd()), "")):
            with self.assertRaises(AnnotationError) as raised:
                AnnotationWorker().run(root, identity, "en", ["text"])
            self.assertEqual(raised.exception.reason, "AI_LOCAL_EXECUTION_LOAD_FAILED")


if __name__ == "__main__":
    unittest.main()
