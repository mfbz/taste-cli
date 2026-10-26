# Security

taste-cli holds a user's Taste Engine sign-in and API key, and its calls spend credits, so security reports matter.

## Reporting

Please report vulnerabilities privately through GitHub's "Report a vulnerability" (Security → Advisories) on this repository. Don't open a public issue. We aim to reply within 7 days (a goal, not a promise: this is a small open-source project).

Vulnerabilities in the Taste Engine itself (its API, sign-in or dashboard) belong to Taste Labs, not here: see [the Taste Engine documentation](https://docs.tastelabs.com).

## In scope

- Credentials: browser sign-in, API keys, how they are stored, refreshed and forgotten, and keeping them out of every output.
- Error output: messages come only from taste-cli's catalogue, never from a library or the API.
- Spending credits: nothing paid is ever retried or started without the user asking for it.
- Files taste-cli writes, such as downloaded bundles: nothing is ever written outside the folder asked for.

Known limit: asset addresses in a download manifest are checked by name (public `https` only, no private or loopback address), without a DNS lookup, so a public name that resolves to a private address is fetched. The request carries no credential, and what comes back is only written into the folder you chose. Details: [TASTE-CLI.md](TASTE-CLI.md), "Saving the files".

- The guards, the Git hooks, CI and the release workflow.

## Design rules we hold ourselves to

- No secrets in arguments, logs, `--debug` output or error messages.
- Errors come from a fixed catalogue with a stable code and a hint; untrusted server text is stripped of control characters before it is shown.
- No telemetry and no update notifier: taste-cli talks only to Taste's API, its sign-in service, and the asset addresses a download names.
- No API key, token or personal data in the repository; the guards check every commit.

Details: [TASTE-CLI.md](TASTE-CLI.md).

## If your key leaked

Revoke it in the Taste Engine dashboard and create a new one. A key that was ever pushed, pasted or logged can't be made secret again; removing it from Git history doesn't help.

There is no bug bounty.
