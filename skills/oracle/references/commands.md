# Oracle command reference

Use this reference when preparing or reconnecting an Oracle run. These command shapes preserve the existing CLI workflow; confirm flags, engine support and model availability with the installed `oracle --help` before using them. Keep the active user's transmission and paid-model authority.

## Prepare the bundle

```sh
oracle --help
oracle --dry-run summary --files-report -p '<task>' --file 'src/**' --file '!**/*.test.*'
oracle --dry-run full -p '<task>' --file 'src/index.ts'
```

If installation is authorized and the binary is missing, the package entrypoint is `npx -y @steipete/oracle --help`; prefer npm/npx to pnpx for the package's native SQLite bindings.

`--file` accepts files, directories and globs, can repeat, and supports exclusion globs. Quote patterns so the CLI expands them. A narrow owner-plus-callers bundle is preferable to the whole repository. Use `--files-report` to inspect the actual selection: ignored directories, gitignore handling, symlinks, dotfiles and file-size limits are CLI behavior to verify rather than assumptions about what was sent.

```sh
oracle --dry-run summary --files-report -p '<task>' --file src/index.ts --file docs --file README.md
oracle --dry-run summary --files-report -p '<task>' --file 'src/**' --file '!src/**/*.test.ts' --file '!**/*.snap'
```

Exclude secrets, environment files, auth tokens and private payloads. The reviewer starts without project knowledge. Preserve the briefing, exact question, relevant file map, redacted error, attempted fixes, constraints and desired response alongside the file manifest for later reuse.

## Run or render

Preserve the existing recipe defaults: `gpt-5.5-pro` for browser runs and `gpt-5.5` for API runs, unless the user selects another model. Confirm availability before running; an unavailable default is not permission to substitute a model.

```sh
oracle --engine browser --model gpt-5.5-pro -p '<task>' --file src/index.ts --slug '<short-task-name>'
oracle --engine api --model gpt-5.5 -p '<task>' --file src/index.ts
oracle --render --copy -p '<task>' --file src/index.ts
```

Browser mode requires a supported browser/model session; API mode needs its configured provider access. Inspect `--browser-attachments auto|never|always` when inline versus uploaded context matters. Confirm the render/copy flags in current help before using a clipboard fallback.

Remote browser execution is a separate supported option when its host and credentials are already authorized. Inspect `oracle serve --help` and current remote-host/token options. Use the configured private host and supply its secret through the supported secure mechanism; do not expose a new public server or print a token just to obtain a review.

## Reconnect

```sh
oracle status --hours 72
oracle session '<id>' --render
```

Sessions normally live under `~/.oracle/sessions`, with `ORACLE_HOME_DIR` selecting another configured location; verify the actual record. Retain the returned ID and use status/session commands after a timeout. Reattach to a still-running session instead of duplicating a paid request. Use `--force` only for an intentionally fresh run after checking the duplicate guard.

For a later independent run, reuse the self-contained briefing and reviewed file manifest, then refresh changed source. A new invocation has no memory of an earlier response. Treat findings as advisory until checked against current code and the owning proof.
