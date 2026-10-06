# SEO — public landing page, README and package metadata

**Date:** 2026-10-06
**Status:** done (in-repo); off-repo steps pending, see "Left undone"

## Context
Request: "prepare this repo for SEO". Before: no website, empty GitHub
description/topics/homepage, generic README H1 ("Tokenomics"), package.json with
no `repository`/`homepage`/`bugs`, and README claims that had drifted (Claude
quota "via Headroom" — now `claude /usage`; "tested with Claude only" — Gemini
and Cursor are priced). The dashboard itself runs on localhost, so it cannot
rank; discoverability has to come from GitHub, npm metadata and a public page.

## Decisions
- **Static landing page in `site/`, deployed via GitHub Pages Actions.** Gives
  a crawlable URL with real meta/OG/JSON-LD that a GitHub README cannot carry.
  Rejected: putting it in `docs/` (already the task-record folder; Pages
  "deploy from /docs" would publish those records), and a separate repo
  (splits stars/links).
- **Zero deps kept.** Plain HTML/CSS, no generator. OG image rendered once with
  headless Chrome from an HTML mock, committed as PNG.
- **Keyword targets:** "Claude Code usage/quota", "token usage dashboard",
  "AI coding cost", "Cursor usage", "Antigravity quota", plus the tool names
  (RTK, Headroom, Caveman) whose users are the core audience. No keyword
  stuffing; `<meta keywords>` included but search engines ignore it.
- **`llms.txt`** added so AI assistants/answer engines get an accurate summary.
- **Dashboard `index.html` set to `noindex, nofollow`.** It holds private usage
  data; if anyone exposes it, it must not be indexed.
- **Did not change GitHub repo settings** (description, topics, homepage, social
  preview). Those are outward-facing account changes — left for the owner.

## What changed
- `site/` — `index.html`, `robots.txt`, `sitemap.xml`, `llms.txt`, `og-image.png`, `dashboard.png`
- `.github/workflows/pages.yml` — deploys `site/`
- `README.md` — keyword-bearing H1, badges, intro naming every tool, website link,
  descriptive image alt, FAQ section, fixed stale quota/contributing claims
- `package.json` — `homepage`, `repository`, `bugs`, `author`, sharper
  description, 25 keywords (npm search)
- `index.html` — meta description + `noindex`
- `test/seo.test.js`, `AGENTS.md` §9

## Evidence
- `node --test`: 325/325 pass.
- First run caught a 195-char meta description; trimmed to ~158.
- Mobile (390px) headless render: no horizontal overflow.

## Corrections
- Branch `feat/seo` was briefly created in the main checkout; another session's
  uncommitted `fix/analysis-empty-charts` edits rode along. Moved this work to
  worktree `../tokenomics-seo` and restored that branch untouched.

## Left undone (owner actions)
1. Repo Settings → Pages → Source: **GitHub Actions** (then merge to deploy).
2. Repo description/topics/homepage:
   `gh repo edit phil288/tokenomics --description "…" --homepage https://phil288.github.io/tokenomics/ --add-topic claude-code,…`
3. Repo Settings → Social preview → upload `site/og-image.png`.
4. Google Search Console + Bing Webmaster: verify the Pages URL, submit `sitemap.xml`.
5. Off-site links (the actual ranking driver): awesome-claude-code / awesome-llm
   lists, Show HN, r/ClaudeAI, dev.to post, RTK/Headroom community channels.
6. Optional `npm publish` (package name `tokenomics` availability unchecked).

## How to verify
```bash
rtk node --test test/seo.test.js
rtk google-chrome --headless=new --screenshot=/tmp/s.png --window-size=390,1400 file://$PWD/site/index.html
```
After deploy: https://search.google.com/test/rich-results and https://www.opengraph.xyz/ on the Pages URL.
