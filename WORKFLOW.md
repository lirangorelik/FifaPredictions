# World Cup Prediction Platform — How It Works

An automated system that predicts 2026 FIFA World Cup scorelines and sends them to Telegram. It pulls
betting-market data, runs a math model + an LLM to predict each match, delivers a daily briefing,
then checks the real results and learns from its own mistakes.

> **Why it exists:** to win a prediction game against a friend, scored **+1 point for the correct
> result (win/draw/loss)** and **+3 points for the exact scoreline**. Every design choice optimizes
> for *expected points* under that scoring — not real-money betting.

---

## 1. The big picture

```
                         ┌─────────────────────────────────────────────┐
   EXTERNAL SOURCES      │                 THE PLATFORM                 │     OUTPUT
                         │                                             │
  The Odds API  ───────► │  1. SYNC      pull odds, store snapshots    │
  (odds + scores)        │               (builds line-movement history)│
                         │                      │                      │
  Polymarket    ───────► │                      ▼                      │
  (crowd odds)           │  2. ANALYZE   Poisson model → expected-     │ ──► Telegram
                         │               points pick → Gemini adjusts  │     (daily briefing)
  Tavily        ───────► │               with news/form → predictions  │
  (news/injuries)        │                      │                      │
                         │                      ▼                      │
  Google Gemini ───────► │  3. RESULTS   fetch final scores, compare   │ ──► Telegram
  (the LLM)              │               prediction vs reality         │     ("did we call it?")
                         │                      │                      │
                         │                      ▼                      │
                         │  4. LEARN     Gemini reviews mistakes,      │
                         │               saves lessons → fed back in   │
  Supabase (Postgres) ◄──┤  stores everything: teams, matches, odds,   │
                         │  predictions, results, lessons              │
                         └─────────────────────────────────────────────┘
```

Everything is stored in **Supabase (Postgres)**, and the four jobs run on a schedule via **GitHub
Actions** (or a local scheduler if you run it on a server).

---

## 2. Where it fetches information (data sources)

| Source | What it provides | Used by | Notes / quota |
|---|---|---|---|
| **The Odds API** (`the-odds-api.com`) | Match schedule, moneyline/totals/BTTS/correct-score odds, **and** final scores | Sync job, Results job | Free tier ~500 calls/month. Kept to **1 region** and infrequent syncs to conserve quota. |
| **Polymarket** (`gamma-api.polymarket.com`) | Independent crowd-sourced win/draw/away probabilities | Sync job | Free public search. Optional — skipped gracefully if a match isn't found. |
| **Tavily** (`api.tavily.com`) | Recent news: injuries, lineups, tactical analysis | Analyze job | Free tier. Restricted to last 10 days of news; snippets capped. |
| **Google Gemini** (`generativelanguage.googleapis.com`) | The LLM that writes the final predictions and the post-match lessons | Analyze job, Learn job | Free tier daily request cap. **All matches analyzed in ONE call** to save quota. |
| **Telegram** (`api.telegram.org`) | Delivery channel for predictions + result alerts | All jobs | Sends to your chat; separate admin chat for error alerts. |
| **Supabase** (`*.supabase.co`) | The database — stores all of the above | Everything | Your own DB. |

---

## 3. The four jobs in detail

### Job 1 — Sync odds (`syncMatchesJob.ts`)
**Runs:** frequently in the background (GitHub: `sync-odds.yml`; also right before each daily analysis).
1. Calls The Odds API for upcoming fixtures + odds.
2. Creates/updates the **teams** and **matches** in the DB.
3. Computes consensus odds across bookmakers and **removes the vig** (bookmaker margin) so the
   implied probabilities are "true." Picks the *consensus* goal-totals line, not just the first book's.
4. Looks up Polymarket sentiment for each fixture (optional).
5. Saves a new **`odds_snapshots`** row each time — so over 24h these snapshots form a
   **line-movement history** the model can read.

### Job 2 — Daily analysis (`dailyAnalysisJob.ts` → `analysisPipeline.ts`) ⭐ the core
**Runs:** once per day (GitHub: `daily-analysis.yml`, with 2 fallback times in case GitHub's cron
is flaky; a dedupe guard prevents double-sends).

For every match kicking off in the next 24 hours:
1. **Pulls the latest odds snapshot + 24h history** from the DB.
2. **Builds a Poisson model** (`poissonModel.ts`) — purely from market data, no API call:
   - Derives each team's **expected goals** from the totals line + win probability.
   - Computes the probability of *every* scoreline and of each outcome (win/draw/loss).
   - Calculates the **expected-points-optimal scoreline** for the game's scoring, using
     `Expected points = P(outcome) + 2 × P(exact score)`.
3. **Fetches recent news** for the match from Tavily, and **each team's recent tournament form**
   from the DB.
4. **Builds one big prompt** containing — for every match — the odds, Polymarket sentiment, the
   correct-score grid, line movement, the **Poisson model's optimal pick**, recent form, news, and
   **past lessons** the system has learned.
5. **One Gemini call** analyzes all matches together. Gemini starts from the model's optimal pick
   and only deviates to another high-probability score if the news justifies it.
6. **Validates & saves** each prediction (the outcome is recomputed from the scoreline so they can
   never contradict each other), then **sends one consolidated Telegram message**.

### Job 3 — Results check (`resultsJob.ts`)
**Runs:** every few hours (GitHub: `check-results.yml`).
1. Finds matches whose kickoff has passed but have no result yet.
2. Calls The Odds API scores endpoint (one call covers all of them).
3. Records the final score, then sends a **"did we call it?"** Telegram message comparing the
   prediction to reality.
4. Matches that never get a result within ~4 days are marked **`abandoned`** so they stop being
   re-checked forever (and so the learning step isn't blocked).

### Job 4 — Learning (`learningPipeline.ts`)
**Runs:** periodically (GitHub: `learning.yml`).
1. Finds finished matches that have a prediction but no lesson yet.
2. Sends Gemini the prediction vs the actual result, plus each team's form.
3. Gemini classifies each (e.g. `EXACT_SCORE`, `WRONG_OUTCOME`, `RIGHT_BUT_UNLUCKY`) and writes one
   **actionable lesson**.
4. Lessons are saved and **injected into future prediction prompts** (most recent 30) — a
   self-improving feedback loop.

---

## 4. How a prediction is actually made (the brain)

```
   Market odds (totals line + win probability)
              │
              ▼
   ┌──────────────────────┐     Poisson math gives a probability for
   │   POISSON MODEL       │     every possible scoreline, then picks the
   │   (poissonModel.ts)   │     one that maximizes EXPECTED POINTS:
   └──────────┬───────────┘        P(correct outcome) + 2 × P(exact score)
              │  "optimal pick: 2-0"
              ▼
   ┌──────────────────────┐     Gemini gets the optimal pick as its default,
   │   GEMINI (LLM)        │ ◄── plus news (Tavily), recent form, Polymarket,
   │   adjusts with context│     and past lessons. It only overrides the pick
   └──────────┬───────────┘     when concrete news justifies it.
              │  "final: 2-0, confidence 7"
              ▼
   ┌──────────────────────┐
   │  SAVE + SEND          │     Outcome recomputed from the score (can't
   │  (validate → DB → TG) │     contradict). Sent to Telegram.
   └──────────────────────┘
```

This combo is the key improvement: the **math** kills the old "everything is 2-1" bias and tunes to
the game's scoring, while the **LLM** still adds the human factors (injuries, must-win games) that
pure math can't see.

---

## 5. Scheduling

Two ways to run the same jobs:

- **GitHub Actions (primary, serverless):** four cron workflows in `.github/workflows/` —
  `sync-odds.yml`, `daily-analysis.yml`, `check-results.yml`, `learning.yml`. Each runs a script in
  `scripts/`. Secrets (API keys) are stored in GitHub repo settings. A fifth workflow, `ci.yml`,
  runs the build + tests on every push (no secrets needed).
- **Long-running server (optional):** `src/index.ts` starts an in-process scheduler
  (`scheduler.ts`) that runs the jobs on timers, plus an optional read-only web dashboard.

Key timing settings live in `.env` (cron expressions, sync cadence, timezone, dedupe window).

---

## 6. Database (Supabase / Postgres)

| Table | Holds |
|---|---|
| `teams` | Team names |
| `matches` | Fixtures, kickoff time, status (`scheduled`/`finished`/`abandoned`/…), and final score |
| `odds_snapshots` | One row per sync — odds, vig-free probabilities, Polymarket, correct-score grid. The history. |
| `predictions` | Each prediction: scoreline, outcome, confidence, the market consensus & analytical edge |
| `prediction_learnings` | One lesson per finished prediction, fed back into future prompts |

Schema changes live in `supabase/migrations/`. Apply them with `npm run migrate` (needs
`DATABASE_URL`) or via the Supabase dashboard.

---

## 7. Tech stack

- **Language:** TypeScript (ESM), Node 22, run via `tsx`.
- **Database/client:** Supabase (`@supabase/supabase-js`).
- **LLM:** Google Gemini (`@google/generative-ai`), with structured-JSON output enforced by a schema
  and re-validated with **zod**.
- **Scheduling:** GitHub Actions cron (primary) or `node-cron` (server mode).
- **Web:** Express (optional read-only dashboard at `/` and `/accuracy`).
- **Tests:** Node's built-in test runner via `tsx` (`npm test`) — covers the pure math
  (vig removal, Poisson model, score parsing, outcome consistency).

---

## 8. Dashboard & accuracy tracking

If enabled (`DASHBOARD_PORT`), a small web page shows upcoming predictions and an **accuracy page**
with:
- Exact-score and correct-outcome hit rates.
- A **Brier score** (how well-calibrated the confidence numbers are; lower is better).
- **Hit rate by confidence bucket** — does an "8/10" really beat a "4/10"?

---

## 9. Common commands

```bash
npm run dev            # run the whole thing locally (scheduler + dashboard)
npm run build          # type-check / compile
npm test               # run unit tests
npm run migrate        # apply DB migrations (needs DATABASE_URL)

npm run run:sync       # one-off: sync odds now
npm run run:analysis   # one-off: run the daily analysis now
npm run run:results    # one-off: check results now
npm run run:learning   # one-off: run the learning step now
npm run dashboard      # just the web dashboard

# Re-send ALL next-24h games even if already sent (bypass dedupe):
BATCH_DEDUPE_HOURS=0.001 npx tsx scripts/runDailyAnalysis.ts
```
