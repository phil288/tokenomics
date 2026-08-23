# Claude quota from `claude /usage` instead of Headroom

**Date:** 2026-08-23
**Status:** done

## Context

The Claude card's quota bars (5h session, 7d all-models, per-model 7d) were
sourced from Headroom's `~/.headroom/subscription_state.json` — the proxy's
mirror of Anthropic's quota API. That made the dashboard's view of Claude usage
dependent on a third-party proxy still running and still polling. Headroom's
`latest.polled_at` existed precisely because a dead proxy leaves the bars
looking live forever.

Claude Code ships its own `/usage` slash command, which is the account's own
answer to the same question. Using it removes the middleman.

## Decisions

- **`claude -p "/usage"` works in print mode — no PTY driver needed.** Unlike
  `agy` (a bubbletea TUI that needs `src/agy-usage.py` and a real window size),
  the Claude CLI renders `/usage` fine to a pipe. Confirmed before building;
  no Python driver was written.
- **Own slow timer, not the SSE loop.** Measured ~11 s per call, longer than
  the 10 s `REFRESH_MS`. So it follows the `pollAntigravity` pattern exactly:
  `pollClaude()` on `CLAUDE_POLL_MS` (default 300000 = 5 min), with
  `collectStats()` only reading the cache. Putting it in the fast loop would
  have made every SSE frame wait on an 11 s subprocess.
- **CLI only; Headroom quota dropped** (user's call, over the offered
  "CLI primary, Headroom fallback"). `stats.headroom.latest` no longer feeds
  the card. Headroom is still read for savings, window telemetry, and the
  health pill.
- **Quota bars only** (user's call). The CLI also prints a "What's contributing
  to your limits usage?" block (24h/7d request + session counts, parallel-session
  %, subagent-heavy %, top subagents). *Rejected* for now: rendering it means new
  markup, CSS, and card tests, for data the card never showed. The parser
  deliberately discards it, and a test asserts none of it leaks into the quota
  object.
- **Reset timestamps parsed timezone-aware, via `Intl`, not a tz dependency.**
  The CLI prints local wall-clock with the zone named and *no year*
  (`resets Aug 26, 10:59pm (Europe/Paris)`). Two traps handled: a December→January
  reset would resolve into the past (rolled forward a year when the naive result
  is >30 d behind now), and the offset itself shifts across a DST boundary
  (resolved twice). Zero-dependency rule respected — `Intl.DateTimeFormat` only.
- **An error must not blank the card.** `renderClaude`'s guard was
  `if (!d || d.error)`. Since the poller keeps the last good `latest` and just
  flags `stale`, that would have thrown away valid bars on a single failed poll.
  Now `if (!d)`, and the freshness line reports the age.

## What changed

- **`src/collectors-claude.js`** (new) — `parseClaudeUsage`, `parseResetAt`,
  `pollClaude`, `getClaudeCache`. Maps CLI labels to the keys the card already
  renders: `Current session` → `five_hour`, `Current week (all models)` →
  `seven_day`, `Current week (Fable)` → `seven_day_fable`. Because the shape is
  unchanged, per-model window discovery, pacing, alerts and history all kept
  working untouched.
- **`src/collectors.js`** — `buildClaude(users, headroom)` puts the poll cache on
  `stats.claude`, carrying `users` and Headroom's `health` (the card shows both).
  Per-user `claude.latest` dropped: quota is account-wide, not per-home.
- **`server.js`** — `CLAUDE_POLL_MS` timer + boot poll + repoll when
  `CLAUDE_ENABLED` is switched back on.
- **`src/web/main.js`** — both render paths (SSE frame and the 1 s clock tick)
  now pass `stats.claude`.
- **`src/web/cards-claude.js`** — `polled_at` read from the poll cache
  (`d.polled_at`, was `lt.polled_at`); fallback message reworded to
  pending-vs-failed; error guard fixed; comments updated.
- **`src/history.js`** — `q5`/`q7` carry-over reads `stats.claude.latest`.

## Evidence

- Latency measured at **10961 ms** for one `claude -p "/usage"` call — the
  reason for the separate timer.
- Parser against real CLI output: `10:59pm (Europe/Paris)` in August →
  `2026-08-26T20:59:00.000Z`, round-tripping back to `22:59` Paris (CEST, UTC+2).
  DST check: `Mar 30` → UTC+2, `Mar 20` → UTC+1. Rollover: `Jan 2` seen from
  `2026-12-28` → 2027.
- Live server on port 3199, SSE frame carried real quota:
  `five_hour 15%`, `seven_day 50%`, `seven_day_fable 14%`, `stale: false`,
  health pill intact.
- `compactSnapshot` against a live parse → `q5=5 q7=49`.
- **Full suite: 255/256 pass** (after the follow-up test). The one failure,
  `TOKENOMICS_HOMES aggregates Caveman and Headroom state across homes`
  (`test/multi-home.test.js`), was **confirmed pre-existing** by stashing all
  changes and re-running on the clean tree — it picks up the real
  `~/snap/code/255/.local/share` instead of only the temp home. Unrelated to
  this work; left alone.

## Follow-up: "No Claude quota data" + stale subtitle

Reported after the first pass, from a screenshot showing a red
**"No Claude quota data"** and the subtitle **"via Headroom"**.

- **The red error was a stale browser tab**, not a code bug. Reproduced the
  server side: booted the current code, rendered `renderClaude` against the live
  SSE payload — 3 correct bars (22% / 51% / 14%), `poll-age fresh`, no `err` div.
  The hard `!d` message only fires when `stats.claude` is absent entirely, which
  is what old cached `main.js` (still reading `stats.headroom`) produces. Per
  §6's own gotcha in AGENTS.md: the DOM only updates from SSE frames, so a
  hard-refresh is required after a source change.
- **The subtitle was a real miss** — `index.html` still read
  `Claude quota <span class="card-sub">via Headroom</span>`. Fixed to
  `via claude /usage`, with a regression test asserting the new text and the
  absence of the old.
- **Confirmed the boot window behaves.** For ~11 s after start the cache is
  `{ stale: true }` with no `latest` and no `error`; the card correctly shows the
  grey *"Claude quota poll pending (claude /usage)"* note rather than the red
  error. This is why the `if (!d)` (not `if (!d || d.error)`) guard matters.

## Corrections

- The two sample runs early on showed `resets ... 2pm` and then `1:59pm` for the
  same window. That is the CLI rounding a relative time, not a parsing bug — it
  is why the reset is parsed to an absolute instant rather than trusted as a
  stable string.

## Left undone

- The "What's contributing" block is parsed away, not surfaced (see Decisions).
- The pre-existing `multi-home` test failure.
- No settings-modal control for `CLAUDE_POLL_MS` — env var only, matching how
  `ANTIGRAVITY_POLL_MS` is handled.

## How to verify

```bash
rtk node --test test/collectors-claude.test.js test/cards-claude-quota.test.js test/history.test.js
rtk node -e 'require("./src/collectors-claude").pollClaude().then(()=>console.log(require("./src/collectors-claude").getClaudeCache()))'
```
