# Set up unattended login on a new Mac

Use this guide when the owner requests setup. This method keeps credentials in
1Password and stores only a machine-specific service-account token in the macOS
login Keychain. It does not cache individual passwords or authenticator seeds.

## Install the skill and prerequisites

1. Install the shared source with
   `npx skills add udecode/dotai --skill passwords --agent codex claude-code --global -y`,
   or extract the shared `passwords` folder into `~/.agents/skills/`.
2. For Claude, link `~/.claude/skills/passwords` to
   `../../.agents/skills/passwords`. Inspect any existing destination first.
   Preserve an existing skill rather than overwriting it without review.
3. In each agent's global instructions, add a pointer to the installed skill.
   Preserve existing instructions. Use `~/.codex/AGENTS.md` for Codex and
   `~/.claude/CLAUDE.md` for Claude. Expand paths for the recipient's home folder.

   > Before website or app login, credential retrieval, or a manual-login
   > handoff, read `~/.agents/skills/passwords/SKILL.md`. Follow its authentication
   > method and preserve the task's separate approval requirements.

4. Install or locate the 1Password desktop app and
   [1Password CLI](https://www.1password.dev/cli/get-started).
   Discover `op` with `command -v op`. Do not assume an Apple Silicon install path.
5. Sign in to the intended 1Password account and enable the desktop app's CLI
   integration if using it. Keep personal CLI authentication in one persistent
   session. The owner handles initial unlock, installation prompts, and physical
   authentication when required.
6. Verify that the agent can control the intended browser or native app and pass
   credentials directly from memory to its UI tools. If it cannot, configure an
   authorized autofill tool or extension before promising unattended login.

## Establish the owner's access and approval choices

1. Record which accounts and custom vaults the owner authorizes for automation.
   Keep existing human access intact. A service account can read several custom
   vaults, so a dedicated automation vault is optional.
2. If required items are in built-in Private or Personal, identify the exact
   items and agree on their destination before moving them. Collections do not
   grant access. Moving an item can change human access and item references.
   Do not bulk-move items merely because they look work-related.
3. Record whether routine password login, stored authenticator codes, accessible
   email or SMS challenges, and remembering the device are authorized. Record
   actions that still need the owner. Do not inherit another person's preferences.
4. Explain the access being granted. A process running as the Mac user that can
   invoke the trusted Keychain reader can obtain the token. Read-only access
   protects 1Password records from edits, but a retrieved password retains its
   normal permissions on the website. The main skill keeps itsme manual.

Proceed within the owner's stated scope without asking again for each routine
step. A missing vault selection or permission is a decision to resolve before
creating that access.

## Create a separate service account for this Mac

1. Use the owner's personal session to confirm the intended account and selected
   vault IDs. Check for an existing machine-specific service account or recovery
   item before creating a duplicate.
2. Choose a recognizable name such as `agents-<device>-<purpose>`. Record the
   owner's expiry choice, including whether no expiry is intended. Check the
   installed CLI's `service-account create --help` for supported options.
3. Create the account with `read_items` on the approved vaults. Omit write,
   sharing, and vault-creation permissions. Capture the one-time token in memory.

   An argument-array example for a captured subprocess is:

   ```text
   op service-account create agents-<device>-<purpose> --vault <vault>:read_items --raw
   ```

   Repeat `--vault` for additional approved vaults. Add `--expires-in` when the
   owner selects an expiry. Never run this command with its token output exposed
   to the terminal, agent transcript, or chat. Catch subprocess failures without
   printing captured output.
4. If the account cannot create service accounts, follow the
   [official setup guide](https://www.1password.dev/service-accounts/get-started)
   and resolve the missing account permission with the owner or administrator.
   Do not replace this method with a permanently unlocked personal session.

Service-account grants are immutable. A later grant change requires a replacement
service account. Built-in Private, Personal, Employee, and default Shared vaults
cannot be granted under the current documented restrictions.

## Store the token and recovery copy

1. Discover the Mac username and login Keychain path. Choose a unique Keychain
   service such as `com.agents.1password.<device>.<purpose>`. Check for an existing
   entry before storing or replacing it.
2. Feed the token to `/usr/bin/security -i` over standard input using a captured
   subprocess. Send one `add-generic-password` command with the chosen account,
   service, login Keychain path, and `-T /usr/bin/security`. Quote each value for
   the interactive parser. Reject newlines or other control characters in input.
   Keep the token out of the subprocess argument array. Capture both output
   streams because interactive tools can echo input. Do not use `-A`.
3. Read the entry back with captured `security find-generic-password` output and
   compare the token in memory. Handle any macOS access or unlock prompt with the
   owner. Verify fresh-process access before claiming prompts are removed.
4. Save a recovery item in the owner's built-in Private or Personal vault through
   the personal session. Capture `op item template get Password --format json`,
   fill the concealed password field in memory, and pass the JSON on standard
   input to `op item create --vault <recovery-vault> --title <recovery-title> -`.
   Capture the result and record only its nonsecret ID and title.
   Do not put the token in command arguments, a temporary file, or a clipboard.
5. Write `~/.config/agent-passwords/machines/<device>.md` with owner-only file
   permissions. Keep this local record outside the installed skill folder so
   skill updates preserve it. Include only
   the device identity, account identity, CLI path, service-account ID, granted
   vault IDs, Keychain service, Keychain account, Keychain path, recovery item ID,
   expiry, owner preferences, verification results, and recovery procedure.

If recovery storage fails, report that failure and retain the verified Keychain
entry. Do not silently create another token or claim setup is complete.

## Verify fresh access and one actual login

1. Start a fresh process with personal `OP_SESSION*`, `OP_ACCOUNT`, existing
   `OP_SERVICE_ACCOUNT_TOKEN`, `OP_CONNECT_TOKEN`, and `OP_CONNECT_HOST` removed.
2. Capture the Keychain token in that process. Set `OP_SERVICE_ACCOUNT_TOKEN`
   only in the child environment used for `op`. Keep it out of shell profiles.
3. Capture `op whoami --format json`. Confirm `SERVICE_ACCOUNT` and record its
   ID. Check that listed vaults match the authorized grants.
4. Read the required fields of one real item from each granted vault. Report
   success as booleans or nonsecret metadata. A token length or an exit code alone
   is insufficient proof. Do not print field values.
5. Choose an authorized service that is already signed out, or use a separate
   browser profile. Preserve existing working sessions. Follow the main skill to
   complete password login and any existing supported challenge.
6. Verify the authenticated page and displayed account through the UI. Record
   whether credential retrieval and actual login each passed. If human presence
   is required, leave the exact challenge ready and report the limitation.

A successful test on one site does not prove every site works. Reboot, FileVault,
a locked Keychain, physical factors, runtime confirmations, and provider security
checks can still require the owner.

## Recover, rotate, or revoke

For recovery on the same Mac, read its recovery item through the personal
persistent session and repeat the Keychain storage and fresh-read verification.
For another Mac, create a separate service account rather than reusing this token.

For rotation, provision and verify the replacement before retiring the old
account. Keep the approved grants and expiry choice. Update the local metadata
and recovery item, then verify the old token is denied after revocation.

For requested revocation, use the account's **Developer > Service accounts** page.
Verify that the old token can no longer read a real item. Removing a local
Keychain entry alone does not revoke remote access. Remove recovery or local
entries only within the requested cleanup scope.

## Share a portable copy

Share the `udecode/dotai` install command, or package only `SKILL.md` and this guide
under a `passwords/` folder. Exclude every
machine configuration, recovery record, account ID, and private proof artifact.
Inspect the archive contents before sharing. The recipient uses their own
1Password account, vault choices, token, and approval preferences.

The recipient can start with this request:

> Use the passwords skill to set up unattended login on this Mac. Inspect the
> prerequisites and existing configuration first. Ask me for my vault scope and
> approval preferences, then complete the authorized setup and verify a real
> login. Keep all tokens and credentials out of output and files.

For current creation flags and limitations, consult the
[service-account command reference](https://www.1password.dev/cli/reference/management-commands/service-account).
