import difflib
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


CHECKER = Path(__file__).with_name("check-pstack-preservation.py")


class PreservationTests(unittest.TestCase):
    def check(self, before, after, patch=None, status="adapted", upstream_hash=None):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            script = root / "scripts" / CHECKER.name
            script.parent.mkdir()
            shutil.copyfile(CHECKER, script)
            owner = root / "skills" / "example"
            owner.mkdir(parents=True)
            (owner / "SKILL.md").write_bytes(after.encode())
            entry = {
                "upstream": "skills/example/SKILL.md",
                "destination": "SKILL.md",
                "upstreamSha256": upstream_hash or hashlib.sha256(before.encode()).hexdigest(),
                "destinationSha256": hashlib.sha256(after.encode()).hexdigest(),
                "status": status,
                "reasons": ["Adapt the runtime."],
                "unifiedDiff": patch if patch is not None else "".join(difflib.unified_diff(
                    before.splitlines(keepends=True), after.splitlines(keepends=True),
                    fromfile="skills/example/SKILL.md", tofile="skills/example/SKILL.md",
                )),
            }
            (owner / "UPSTREAM.json").write_text(json.dumps({
                "source": "https://github.com/cursor/plugins",
                "skill": "example", "files": [entry],
            }))
            result = subprocess.run(["python3", str(script)], capture_output=True, text=True)
            return result.returncode, json.loads(result.stdout)

    def test_exact_replacement_insertion_deletion_and_multiple_hunks(self):
        for before, after in [
            ("one\ntwo\n", "one\nthree\n"),
            ("", "added\n"),
            ("removed\n", ""),
            ("old\n" + "same\n" * 12 + "old\n", "new\n" + "same\n" * 12 + "new\n"),
        ]:
            with self.subTest(before=before, after=after):
                self.assertEqual(self.check(before, after)[0], 0)

    def test_nonempty_malformed_patch_fails_with_matching_destination_hash(self):
        self.assertNotEqual(self.check("before\n", "after\n", "not a patch")[0], 0)

    def test_patch_for_different_content_fails(self):
        patch = "--- old\n+++ new\n@@ -1 +1 @@\n-before\n+different\n"
        self.assertNotEqual(self.check("before\n", "after\n", patch)[0], 0)

    def test_incorrect_hunk_counts_fail(self):
        patch = "--- old\n+++ new\n@@ -1,2 +1 @@\n-before\n+after\n"
        self.assertNotEqual(self.check("before\n", "after\n", patch)[0], 0)

    def test_reconstructed_upstream_hash_must_match(self):
        self.assertNotEqual(self.check("before\n", "after\n", upstream_hash="0" * 64)[0], 0)

    def test_unchanged_requires_equal_hashes(self):
        self.assertEqual(self.check("same\n", "same\n", status="unchanged")[0], 0)
        self.assertNotEqual(self.check("before\n", "after\n", status="unchanged")[0], 0)

    def test_standard_no_final_newline_patch(self):
        patch = "--- old\n+++ new\n@@ -1 +1 @@\n-before\n\\ No newline at end of file\n+after\n\\ No newline at end of file\n"
        self.assertEqual(self.check("before", "after", patch)[0], 0)


if __name__ == "__main__":
    unittest.main()
