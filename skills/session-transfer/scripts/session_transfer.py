#!/usr/bin/env python3
"""Export Claude desktop Code-tab sessions from one account's store and import them into another's.

export: copies the app's session records (optionally their CLI transcripts too) into
        ~/.claude/session-exports/<timestamp>/.
import: copies those records into the store folder of the account now signed in, so the
        sessions reappear in the sidebar with their worktree, branch, PR and history.

Records only ever get added: import never overwrites an existing record or transcript
unless --force is given, and then backs up what it replaces.
"""
import argparse
import datetime as dt
import glob
import json
import os
import shutil
import sys

HOME = os.path.expanduser("~")
STORE = os.path.join(HOME, "Library/Application Support/Claude/claude-code-sessions")
PROJECTS = os.path.join(HOME, ".claude/projects")
EXPORTS = os.path.join(HOME, ".claude/session-exports")

# Fields tied to the account that wrote the record. Reset on import so the new account's
# app does not try to reach the old account's connectors.
ACCOUNT_BOUND = {"remoteMcpServersConfig": [], "connectorKeyHolders": {}}


def store_folders():
    """Every <a>/<b> folder in the store, with its newest record's mtime."""
    out = []
    for a in sorted(os.listdir(STORE)) if os.path.isdir(STORE) else []:
        pa = os.path.join(STORE, a)
        if not os.path.isdir(pa):
            continue
        for b in sorted(os.listdir(pa)):
            pb = os.path.join(pa, b)
            if not os.path.isdir(pb):
                continue
            recs = glob.glob(os.path.join(pb, "local_*.json"))
            newest = max((os.path.getmtime(r) for r in recs), default=0)
            out.append({"key": f"{a}/{b}", "path": pb, "count": len(recs), "newest": newest})
    return out


def active_folder(exclude=None):
    """The folder holding the most recently written record: the signed-in account's."""
    cands = [f for f in store_folders() if f["count"] and f["key"] != exclude]
    if not cands:
        return None
    return max(cands, key=lambda f: f["newest"])


def resolve_folder(key):
    path = os.path.join(STORE, key)
    if not os.path.isdir(path):
        sys.exit(f"No store folder {key}. Run `{sys.argv[0]} folders` to list them.")
    return {"key": key, "path": path}


def load(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def repo_of(rec):
    return os.path.basename((rec.get("originCwd") or rec.get("cwd") or "").rstrip("/"))


def cli_ids(rec):
    ids = [rec.get("cliSessionId")] + list(rec.get("priorCliSessionIds") or [])
    return [i for i in dict.fromkeys(ids) if i]


def transcript_paths(cli_id):
    """The CLI transcript file and its sidecar folder (subagents, tool results)."""
    hits = glob.glob(os.path.join(PROJECTS, "*", cli_id + ".jsonl"))
    hits += [p for p in glob.glob(os.path.join(PROJECTS, "*", cli_id)) if os.path.isdir(p)]
    return hits


def fmt_ms(ms):
    if not ms:
        return "?"
    return dt.datetime.fromtimestamp(ms / 1000).strftime("%Y-%m-%d %H:%M")


def size_of(path):
    if os.path.isfile(path):
        return os.path.getsize(path)
    total = 0
    for root, _, files in os.walk(path):
        for f in files:
            try:
                total += os.path.getsize(os.path.join(root, f))
            except OSError:
                pass
    return total


def human(n):
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.0f} {unit}"
        n /= 1024
    return f"{n:.1f} TB"


# --- folders ---------------------------------------------------------------

def cmd_folders(_args):
    act = active_folder()
    for f in store_folders():
        mark = "  <- signed in (newest record)" if act and f["key"] == act["key"] else ""
        print(f"{f['key']}  {f['count']} records  newest {fmt_ms(f['newest'] * 1000)}{mark}")


# --- export ----------------------------------------------------------------

def cmd_export(args):
    src = resolve_folder(args.source) if args.source else active_folder()
    if not src:
        sys.exit("No session records found.")
    since = None
    if not args.all:
        since = (dt.datetime.now() - dt.timedelta(days=args.since_days)).timestamp() * 1000

    picked = []
    for path in sorted(glob.glob(os.path.join(src["path"], "local_*.json"))):
        try:
            rec = load(path)
        except (OSError, ValueError) as e:
            print(f"skip unreadable {os.path.basename(path)}: {e}", file=sys.stderr)
            continue
        if rec.get("isArchived") and not args.include_archived:
            continue
        if args.repo and repo_of(rec) not in args.repo:
            continue
        if not args.repo and "/scratch-workspaces/" in (rec.get("cwd") or "") and not args.include_scratch:
            continue
        if since and (rec.get("lastActivityAt") or 0) < since:
            continue
        if not args.include_gone and not os.path.isdir(rec.get("cwd") or ""):
            continue
        picked.append((path, rec))
    picked.sort(key=lambda pr: -(pr[1].get("lastActivityAt") or 0))

    print(f"Source store folder: {src['key']}")
    print(f"Selected {len(picked)} sessions")
    tx_bytes = 0
    for _, rec in picked:
        for cid in cli_ids(rec):
            for p in transcript_paths(cid):
                tx_bytes += size_of(p)
    if args.with_transcripts:
        print(f"Transcript backup size: {human(tx_bytes)}")
    if args.dry_run:
        for _, rec in picked:
            print(f"  {fmt_ms(rec.get('lastActivityAt'))}  {repo_of(rec):<14} {rec.get('title')}")
        return

    stamp = dt.datetime.now().strftime("%Y-%m-%dT%H%M%S")
    out = args.out or os.path.join(EXPORTS, stamp)
    os.makedirs(os.path.join(out, "records"), exist_ok=True)
    os.chmod(EXPORTS if out.startswith(EXPORTS) else out, 0o700)

    manifest = {
        "exportedAt": dt.datetime.now().isoformat(timespec="seconds"),
        "sourceFolder": src["key"],
        "filters": {"repo": args.repo, "includeArchived": args.include_archived,
                    "sinceDays": None if args.all else args.since_days,
                    "includeGone": args.include_gone},
        "transcriptsIncluded": args.with_transcripts,
        "sessions": [],
    }
    missing_tx = 0
    for path, rec in picked:
        shutil.copy2(path, os.path.join(out, "records", os.path.basename(path)))
        tx = []
        if args.with_transcripts:
            for cid in cli_ids(rec):
                found = transcript_paths(cid)
                if not found:
                    missing_tx += 1
                for p in found:
                    rel = os.path.relpath(p, PROJECTS)
                    dest = os.path.join(out, "transcripts", rel)
                    os.makedirs(os.path.dirname(dest), exist_ok=True)
                    if os.path.isdir(p):
                        shutil.copytree(p, dest, dirs_exist_ok=True)
                    else:
                        shutil.copy2(p, dest)
                    tx.append(rel)
        manifest["sessions"].append({
            "sessionId": rec.get("sessionId"),
            "title": rec.get("title"),
            "repo": repo_of(rec),
            "cwd": rec.get("cwd"),
            "branch": rec.get("branch"),
            "prs": [p.get("url") for p in rec.get("prs") or [] if p.get("url")],
            "isArchived": bool(rec.get("isArchived")),
            "lastActivityAt": rec.get("lastActivityAt"),
            "transcripts": tx,
        })
    with open(os.path.join(out, "manifest.json"), "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=2)

    lines = [f"# Session export {manifest['exportedAt']}", "",
             f"Source store folder: `{src['key']}`  ", f"Sessions: {len(picked)}", "",
             "| Last activity | Repo | Title | Branch | PR |", "|---|---|---|---|---|"]
    for s in manifest["sessions"]:
        pr = ", ".join(s["prs"]) or ""
        title = (s["title"] or "").replace("|", "\\|")
        lines.append(f"| {fmt_ms(s['lastActivityAt'])} | {s['repo']} | {title} | `{s['branch'] or ''}` | {pr} |")
    with open(os.path.join(out, "index.md"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")
    os.chmod(out, 0o700)

    print(f"Exported to {out}")
    if missing_tx:
        print(f"Warning: {missing_tx} CLI transcript ids had no file under {PROJECTS}")


# --- import ----------------------------------------------------------------

def cmd_import(args):
    src_dir = args.export_dir or latest_export()
    if not src_dir or not os.path.isfile(os.path.join(src_dir, "manifest.json")):
        sys.exit(f"No export found at {src_dir or EXPORTS}")
    manifest = load(os.path.join(src_dir, "manifest.json"))
    dst = resolve_folder(args.to) if args.to else active_folder()
    if not dst:
        sys.exit("No store folder with records found. Open any Code session in the new account first, "
                 "or pass --to <folder> (see `folders`).")
    if dst["key"] == manifest["sourceFolder"] and not args.to:
        sys.exit(f"The signed-in account's folder is the export's own source ({dst['key']}): "
                 "nothing to import. Switch accounts first, or pass --to explicitly.")

    print(f"Export: {src_dir}  ({len(manifest['sessions'])} sessions from {manifest['sourceFolder']})")
    print(f"Target store folder: {dst['key']}")
    backup = os.path.join(src_dir, "import-backup-" + dt.datetime.now().strftime("%Y%m%dT%H%M%S"))
    added = skipped = replaced = tx_restored = 0
    gone, ready = [], []
    for s in manifest["sessions"]:
        name = s["sessionId"] + ".json"
        rec = load(os.path.join(src_dir, "records", name))
        for k, v in ACCOUNT_BOUND.items():
            if k in rec:
                rec[k] = v
        target = os.path.join(dst["path"], name)
        exists = os.path.exists(target)
        if exists and not args.force:
            skipped += 1
            status = "exists, skipped"
        else:
            if not args.dry_run:
                if exists:
                    os.makedirs(backup, exist_ok=True)
                    shutil.copy2(target, os.path.join(backup, name))
                tmp = target + ".importing"
                with open(tmp, "w", encoding="utf-8") as fh:
                    json.dump(rec, fh, ensure_ascii=False)
                os.chmod(tmp, 0o600)
                os.replace(tmp, target)
            replaced += exists
            added += not exists
            status = "replaced" if exists else "added"
        for rel in s.get("transcripts") or []:
            live = os.path.join(PROJECTS, rel)
            saved = os.path.join(src_dir, "transcripts", rel)
            if not os.path.exists(live) and os.path.exists(saved):
                if not args.dry_run:
                    os.makedirs(os.path.dirname(live), exist_ok=True)
                    if os.path.isdir(saved):
                        shutil.copytree(saved, live)
                    else:
                        shutil.copy2(saved, live)
                tx_restored += 1
        if s.get("cwd") and not os.path.isdir(s["cwd"]):
            gone.append(s)
        else:
            ready.append({"sessionId": s["sessionId"], "title": s.get("title"), "repo": s.get("repo")})
        if args.verbose:
            print(f"  {status:<16} {s.get('title')}")

    verb = "Would add" if args.dry_run else "Added"
    print(f"{verb} {added}, replaced {replaced}, skipped {skipped}; restored {tx_restored} transcript files")
    if replaced and not args.dry_run:
        print(f"Replaced records backed up in {backup}")
    if gone:
        print(f"{len(gone)} sessions point at a folder that no longer exists (deleted worktrees); "
              "they import with history but cannot run until the folder is back."
              + ("" if args.verbose else " --verbose lists them."))
        if args.verbose:
            for s in gone:
                print(f"  gone: {s.get('title')}  {s['cwd']}")
    if not args.dry_run:
        out = os.path.join(src_dir, "imported.json")
        with open(out, "w", encoding="utf-8") as fh:
            json.dump({"importedAt": dt.datetime.now().isoformat(timespec="seconds"),
                       "targetFolder": dst["key"], "sessions": ready}, fh, ensure_ascii=False, indent=2)
        print(f"{len(ready)} runnable sessions listed in {out}")
    if not args.dry_run and (added or replaced):
        print("Quit and reopen the Claude app so the sidebar reloads the imported sessions.")


def latest_export():
    dirs = sorted(d for d in glob.glob(os.path.join(EXPORTS, "*"))
                  if os.path.isfile(os.path.join(d, "manifest.json")))
    return dirs[-1] if dirs else None


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("folders", help="list the app's per-account store folders").set_defaults(fn=cmd_folders)

    ex = sub.add_parser("export", help="export sessions of the signed-in account")
    ex.add_argument("--repo", action="append", help="only sessions of this repo (folder name); repeatable")
    ex.add_argument("--since-days", type=float, default=2,
                    help="only sessions active in the last N days (default 2)")
    ex.add_argument("--all", action="store_true", help="no time window")
    ex.add_argument("--include-archived", action="store_true")
    ex.add_argument("--include-scratch", action="store_true", help="also no-folder (scratch) sessions")
    ex.add_argument("--include-gone", action="store_true",
                    help="also sessions whose worktree or folder no longer exists")
    ex.add_argument("--with-transcripts", action="store_true",
                    help="also back up the CLI transcripts (they stay in ~/.claude/projects across accounts)")
    ex.add_argument("--source", help="store folder to export from (default: the signed-in one)")
    ex.add_argument("--out", help=f"output folder (default: {EXPORTS}/<timestamp>)")
    ex.add_argument("--dry-run", action="store_true")
    ex.set_defaults(fn=cmd_export)

    im = sub.add_parser("import", help="import an export into the signed-in account")
    im.add_argument("export_dir", nargs="?", help="export folder (default: the latest)")
    im.add_argument("--to", help="target store folder (default: the signed-in one)")
    im.add_argument("--force", action="store_true", help="replace records that already exist (backed up)")
    im.add_argument("--dry-run", action="store_true")
    im.add_argument("--verbose", action="store_true", help="list every session and every missing folder")
    im.set_defaults(fn=cmd_import)

    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
