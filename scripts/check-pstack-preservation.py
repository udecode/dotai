#!/usr/bin/env python3
"""Check every declared pstack source and optional installed mirror."""

import argparse
import hashlib
import json
import re
from pathlib import Path


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def replay(text, patch, reverse=False):
    lines = patch.splitlines(keepends=True)
    if len(lines) < 3 or not lines[0].startswith("--- ") or not lines[1].startswith("+++ "):
        raise ValueError("invalid single-file unified diff")
    source = text.splitlines(keepends=True)
    output = []
    cursor = 0
    index = 2
    while index < len(lines):
        header = re.fullmatch(r"@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@[^\r\n]*[\r\n]*", lines[index])
        if not header:
            raise ValueError("invalid hunk header")
        old_start, old_count, new_start, new_count = (
            int(value) if value is not None else 1 for value in header.groups()
        )
        index += 1
        changes = []
        while index < len(lines) and not lines[index].startswith("@@ "):
            line = lines[index]
            if line.rstrip("\r\n") == "\\ No newline at end of file":
                if not changes or not changes[-1][1].endswith("\n"):
                    raise ValueError("misplaced missing-newline marker")
                operation, content = changes[-1]
                changes[-1] = (operation, content[:-1])
            elif line[:1] in (" ", "+", "-"):
                changes.append((line[0], line[1:]))
            else:
                raise ValueError("invalid hunk line")
            index += 1
        if sum(op != "+" for op, _ in changes) != old_count or sum(op != "-" for op, _ in changes) != new_count:
            raise ValueError("hunk line counts differ")
        source_start, source_count, target_start, target_count = (
            (new_start, new_count, old_start, old_count) if reverse
            else (old_start, old_count, new_start, new_count)
        )
        source_index = source_start - (source_count > 0)
        target_index = target_start - (target_count > 0)
        if not cursor <= source_index <= len(source):
            raise ValueError("overlapping or out-of-range hunk")
        output.extend(source[cursor:source_index])
        cursor = source_index
        if len(output) != target_index:
            raise ValueError("hunk target position differs")
        removal, addition = ("+", "-") if reverse else ("-", "+")
        for operation, content in changes:
            if operation in (" ", removal):
                if cursor >= len(source) or source[cursor] != content:
                    raise ValueError("hunk content does not match exactly")
                cursor += 1
            if operation in (" ", addition):
                output.append(content)
    return "".join(output + source[cursor:])


def verify_adaptation(path, entry):
    if entry["status"] == "unchanged":
        if entry["upstreamSha256"] != entry["destinationSha256"] or entry.get("unifiedDiff"):
            raise ValueError("unchanged source has an adaptation")
        return
    if entry["status"] != "adapted" or not entry.get("reasons") or not entry.get("unifiedDiff"):
        raise ValueError("missing exact adaptation accounting")
    destination = path.read_bytes().decode("utf-8")
    upstream = replay(destination, entry["unifiedDiff"], reverse=True)
    if hashlib.sha256(upstream.encode()).hexdigest() != entry["upstreamSha256"]:
        raise ValueError("replayed upstream hash differs")
    if replay(upstream, entry["unifiedDiff"]) != destination:
        raise ValueError("adaptation does not reproduce destination")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--upstream-root", type=Path)
    parser.add_argument("--install-root", type=Path, action="append", default=[])
    args = parser.parse_args()
    skills = Path(__file__).resolve().parent.parent / "skills"
    remote_file = skills.parent / "upstream-skills.json"
    remote = {row["name"]: row["files"] for row in json.loads(remote_file.read_text())["skills"]} if remote_file.exists() else {}
    errors = []
    count = 0
    file_count = 0
    for manifest in sorted(skills.glob("*/UPSTREAM.json")):
        data = json.loads(manifest.read_text())
        if data.get("source") != "https://github.com/cursor/plugins":
            continue
        owner = manifest.parent
        count += 1
        if data["skill"] != owner.name:
            errors.append(f"{manifest}: skill name does not match directory")
        for entry in data["files"]:
            file_count += 1
            path = owner / entry["destination"]
            if not path.is_file() or digest(path) != entry["destinationSha256"]:
                errors.append(f"{path}: missing file or unreviewed source drift")
            if path.is_file():
                try:
                    verify_adaptation(path, entry)
                except (ValueError, KeyError) as error:
                    errors.append(f"{path}: {error}")
            if args.upstream_root:
                upstream = args.upstream_root / entry["upstream"]
                if not upstream.is_file() or digest(upstream) != entry["upstreamSha256"]:
                    errors.append(f"{upstream}: pinned upstream hash differs")
        for entry in data.get("ownedFiles", []):
            path = owner / entry["path"]
            if not path.is_file() or digest(path) != entry["sha256"]:
                errors.append(f"{path}: owned adapter/license drift")
        for path in owner.rglob("*.md"):
            for target in re.findall(r"\[[^\]]*\]\(([^)]+)\)", path.read_text()):
                target = target.split("#")[0].strip("<>")
                # Prompt examples use a literal placeholder rather than a resource.
                if not target or target == "url" or re.match(r"[a-z]+:|/|<|\$", target):
                    continue
                if not (path.parent / target).exists():
                    resolved = (path.parent / target).resolve()
                    try:
                        parts = resolved.relative_to(skills.resolve()).parts
                    except ValueError:
                        parts = ()
                    if len(parts) < 2 or "/".join(parts[1:]) not in remote.get(parts[0], {}):
                        errors.append(f"{path}: unresolved dependency {target}")
        for install in args.install_root:
            installed = install / owner.name
            source_files = {p.relative_to(owner) for p in owner.rglob("*") if p.is_file()}
            installed_files = {
                p.relative_to(installed) for p in installed.rglob("*") if p.is_file()
            }
            if source_files != installed_files:
                errors.append(f"{installed}: file inventory differs from owned source")
            for relative in source_files & installed_files:
                if digest(owner / relative) != digest(installed / relative):
                    errors.append(f"{installed / relative}: installed content differs")
    if count == 0:
        errors.append("No pstack provenance manifests found")
    print(json.dumps({"skills": count, "upstreamFiles": file_count, "errors": errors}, indent=2))
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
