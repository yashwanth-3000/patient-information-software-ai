import unittest
import json
import tempfile
from pathlib import Path

import clinicclick_runner as runner


class RunnerTests(unittest.TestCase):
    def test_normalized_coordinates_include_region_offset(self):
        self.assertEqual(
            runner.screen_point({"x": 500, "y": 250}, (100, 50, 1200, 800)),
            (700, 250),
        )

    def test_coordinates_are_bounded(self):
        self.assertEqual(runner.denormalize(-10, 1000), 0)
        self.assertEqual(runner.denormalize(1001, 1000), 999)

    def test_consequential_intent_is_blocked(self):
        call = {
            "name": "click",
            "arguments": {"x": 10, "y": 10, "intent": "Click Save to update medical record"},
        }
        self.assertTrue(runner.is_consequential(call))

    def test_safe_search_click_is_not_locally_blocked(self):
        call = {
            "name": "click",
            "arguments": {"x": 10, "y": 10, "intent": "Focus the patient search box"},
        }
        self.assertFalse(runner.is_consequential(call))

    def test_first_payload_uses_desktop_environment(self):
        payload = runner.first_payload("test", "abc", "gemini-3.5-flash")
        self.assertEqual(payload["tools"][0]["environment"], "desktop")
        self.assertTrue(payload["tools"][0]["enable_prompt_injection_detection"])
        self.assertEqual(payload["generation_config"]["thinking_level"], "low")

    def test_continuation_payload_keeps_low_thinking(self):
        payload = runner.continuation_payload("id", [], "abc", "gemini-3.5-flash")
        self.assertEqual(payload["generation_config"]["thinking_level"], "low")

    def test_approved_demo_job_allows_final_save_click(self):
        job = {"patients": [{"first_name": "TEST"}]}
        call = {"name": "click", "arguments": {"x": 10, "y": 10, "intent": "Save patient"}}
        allowed, _ = runner.auto_action_allowed(call, job)
        self.assertTrue(allowed)

    def test_approved_demo_job_still_blocks_delete(self):
        job = {"patients": [{"first_name": "TEST"}]}
        call = {"name": "click", "arguments": {"x": 10, "y": 10, "intent": "Delete patient"}}
        allowed, _ = runner.auto_action_allowed(call, job)
        self.assertFalse(allowed)

    def test_auto_mode_rejects_unapproved_typed_value(self):
        job = {"patients": [{"first_name": "TEST"}]}
        call = {"name": "type", "arguments": {"text": "REAL PERSON", "intent": "Enter name"}}
        allowed, _ = runner.auto_action_allowed(call, job)
        self.assertFalse(allowed)

    def test_clear_word_in_description_does_not_block_add_tab(self):
        job = {"patients": [{"first_name": "TEST"}]}
        call = {
            "name": "click",
            "arguments": {"intent": "Click Add New Patient to see if it clears the form"},
        }
        allowed, _ = runner.auto_action_allowed(call, job)
        self.assertTrue(allowed)

    def test_clicking_clear_button_is_blocked(self):
        job = {"patients": [{"first_name": "TEST"}]}
        call = {"name": "click", "arguments": {"intent": "Click Clear button"}}
        allowed, _ = runner.auto_action_allowed(call, job)
        self.assertFalse(allowed)

    def test_backspace_to_remove_extra_digit_is_allowed(self):
        job = {"patients": [{"first_name": "TEST"}]}
        call = {
            "name": "press_key",
            "arguments": {"key": "BACKSPACE", "intent": "Remove the extra digit from Age"},
        }
        allowed, _ = runner.auto_action_allowed(call, job)
        self.assertTrue(allowed)

    def test_load_approved_job_requires_demo_marker(self):
        job = {
            "job_id": "x",
            "status": "approved",
            "demo": False,
            "task": "create_patients",
            "patients": [{"first_name": "TEST"}] * 5,
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "job.json"
            path.write_text(json.dumps(job), encoding="utf-8")
            with self.assertRaises(RuntimeError):
                runner.load_approved_job(path)


if __name__ == "__main__":
    unittest.main()
