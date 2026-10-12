# Recover credential access

Use this route when normal service-account retrieval fails, the account or item
is unclear, or credentials have moved or changed. Reading credentials does not
authorize moving items or changing sharing. A missing token does not authorize
provisioning or copying another machine's token.

A paused browser sync badge or an inaccessible profile does not establish the
service's authentication state. Verify the service through supported UI controls.

## Use personal access when needed

For personal access or authorized provisioning, use one persistent shell or PTY
for the whole task. Run `op signin` once if necessary and reuse that exact
session for subsequent operations. Keep the service token out of the personal
session's environment. Do not use personal sign-in for routine service-account
reads. Service accounts cannot read the built-in Private vault.

If the CLI cannot reach the 1Password desktop app, open the app through supported
native controls and retry in the same session. Ask the owner only when access
remains locked or unavailable, no plausible item exists, the account remains
ambiguous, or human presence is technically required. Report the specific
blocker and attempted recovery without exposing secret-bearing command output.

## Resolve stale items and changed credentials

Use the current canonical item after a move or rotation. Consult recorded ID
mappings when a reference is stale. If an authorized automation copy exists,
refresh it from its source after a credential change before retrying. Prefer
authorized moves over permanent copies, but preserve human sharing and the
project's migration scope.

After a provider rejects credentials, inspect the concrete failure before
another attempt. Do not repeat a rejected credential without a resolved cause.
For token recovery, rotation, or revocation within an authorized setup task,
read the relevant section of [the setup guide](new-mac.md).

When the remaining action requires the owner, use [the focused handoff](handoff.md).
