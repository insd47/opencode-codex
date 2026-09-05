# opencode-codex

<img width="1148" height="679" alt="demo" src="https://github.com/user-attachments/assets/b95327da-0b02-4506-bb2f-da036e651fd3" />

A clean, native multi-account Codex (ChatGPT Plus/Pro OAuth) integration for
[OpenCode](https://opencode.ai). Adds multiple-account support, account
switching, and per-account quota tracking — all through OpenCode's standard
flows instead of bespoke CLIs or custom dialogs.

> ### ⚠️ Use at your own risk
>
> This plugin lets you attach more than one Codex account to the same OpenCode
> instance. Depending on how you use it, that may run against the OpenAI Terms
> of Service. Only attach accounts that belong to you, and don't rely on
> rotation to dodge rate limits in a way that violates ToS.

## What it does

- **Multi-account OAuth.** Log in once per account through the standard
  `opencode auth login` → `openai` flow (browser / device code / paste
  callback URL). Each login adds another account.
- **Account switching inside the TUI.** `/accounts` opens a picker showing
  every connected account, its plan, and current 5h/weekly usage.
- **Standard logout flow.** Removing accounts is just
  `opencode auth logout` — each account appears as its own entry.
- **Automatic fallback.** Requests go through the active account; if it hits
  a 429/quota wall the next eligible account picks up so you don't have to
  babysit the switcher.
- **Live quota in the sidebar.** Two-tone progress bars for the active
  account's 5h and weekly windows, plus a pool aggregate when multiple
  accounts are connected.

## Installation

Before installing, it's recommended to log out of every Codex account
currently signed in to **OpenCode**.

```sh
opencode plugin add @insd47/opencode-codex
```

## Adding accounts

Run `opencode auth login`, pick **openai**, and choose one of the three OAuth
methods:

| Method                                    | When to use                                                                                                            |
|-------------------------------------------|------------------------------------------------------------------------------------------------------------------------|
| **ChatGPT Pro/Plus (browser)**            | Local machine with a graphical browser. The plugin spins up a one-shot callback server on `localhost:1455`.            |
| **ChatGPT Pro/Plus (device code)**        | Remote / headless setup; enter a short code on another device that has a browser.                                      |
| **ChatGPT Pro/Plus (paste callback URL)** | Sandboxed environments where neither of the above works — you open the URL manually and paste the redirected URL back. |

Every successful login is appended to the account store and becomes the active
account. Repeat for additional accounts.

## Managing accounts

<img width="1135" height="680" alt="account switching" src="https://github.com/user-attachments/assets/5a8856a1-333e-4be3-a677-dde164f40ea8" />

| Action | Where                          |
|--------|--------------------------------|
| Add    | `opencode auth login` → openai |
| List   | `opencode auth list`           |
| Switch | `/accounts` in the TUI         |
| Remove | `opencode auth logout`         |

Under the hood the plugin keeps a `openai/<email>` entry in `auth.json` per
connected account and keeps the canonical `openai` key as a compatibility
mirror — so OpenCode's provider system sees a normal OAuth credential while the
plugin reads the account pool from OpenCode's standard auth store. Account
switching inside an open TUI process is kept in memory and is not persisted.

## Quota display

The sidebar shows two sections when multiple accounts are connected:

- **Quota** — the active account's 5h and weekly windows, with a reset
  countdown and percent remaining.
- **All Quota** — pooled aggregate across every connected account, so you can
  see how much headroom your set has overall.

When only one account is connected, just **Quota** is shown.

Usage data is fetched in memory from `chatgpt.com/backend-api/wham/usage`:

- once on TUI startup,
- on every `session.idle` event (debounced),
- and every 5 minutes thereafter.

`All Quota` weights each account by its effective plan capacity. Plus uses 1x,
while explicit Pro 5x and Pro 20x plan names use 5x and 20x. The usage API may
report either Pro tier only as `pro`; those ambiguous accounts use a conservative
1x fallback unless you provide a per-account override when starting OpenCode:

```sh
export OPENCODE_CODEX_QUOTA_MULTIPLIERS='{"pro5@example.com":5,"pro20@example.com":20}'
opencode
```

The plugin matches these keys against each account's email. Account IDs and
labels can also be used directly, with `id:` and `label:` prefixes available to
disambiguate them. Multipliers must be positive numbers. The 5-hour and weekly
rows are weighted independently, and accounts without fetched usage remain
excluded.

## Storage

| Path                                          | Purpose                                                                                                                                                                 |
|-----------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `$XDG_DATA_HOME/opencode/auth.json`           | OpenCode's credential file and the source of truth for Codex OAuth tokens. One entry per account at `openai/<email>` plus the compatibility mirror at `openai`.         |

Quota, temporary rate-limit state, and the TUI account selection are process
memory only. They are refreshed again after restarting OpenCode.

## Troubleshooting

**`/accounts` says "No accounts" right after install.**
Make sure you've logged in at least once with `opencode auth login` → openai.
If you migrated from another multi-account plugin, your previous tokens won't
auto-import — log in again.

**Logging out via `opencode auth logout` and then chatting fails.**
Pick a different account with `/accounts`, or run `opencode auth login` again.
The plugin only restores the active mirror when there's at least one account
left.

**Sidebar shows `5h —` or `weekly —`.**
Usage data hasn't been fetched yet. It populates on the next idle event or 5
minutes after startup. If it stays blank, your active token may be revoked —
re-authenticate.

## License

[MIT](./LICENSE)
