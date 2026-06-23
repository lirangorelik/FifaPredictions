import { test } from "node:test";
import assert from "node:assert/strict";
import {
  summarizeMoneyline,
  summarizeTotals,
  summarizeCorrectScore,
  parseFinalScore,
  type OddsApiEvent,
  type OddsApiScoreEntry,
} from "../src/services/oddsMath.js";

function event(partial: Partial<OddsApiEvent>): OddsApiEvent {
  return {
    id: "evt1",
    sport_key: "soccer_fifa_world_cup",
    commence_time: "2026-06-24T18:00:00Z",
    home_team: "Brazil",
    away_team: "Serbia",
    bookmakers: [],
    ...partial,
  };
}

test("summarizeMoneyline removes vig so implied probabilities sum to 1", () => {
  const e = event({
    bookmakers: [
      {
        key: "b1",
        title: "B1",
        last_update: "",
        markets: [
          {
            key: "h2h",
            outcomes: [
              { name: "Brazil", price: 1.5 },
              { name: "Draw", price: 4.0 },
              { name: "Serbia", price: 7.0 },
            ],
          },
        ],
      },
    ],
  });

  const ml = summarizeMoneyline(e);
  assert.equal(ml.homeOdds, 1.5);
  const sum = ml.homeImpliedProb! + ml.drawImpliedProb! + ml.awayImpliedProb!;
  assert.ok(Math.abs(sum - 1) < 1e-9, `implied probs should sum to 1, got ${sum}`);
  // Shortest odds must map to the highest probability.
  assert.ok(ml.homeImpliedProb! > ml.drawImpliedProb!);
  assert.ok(ml.drawImpliedProb! > ml.awayImpliedProb!);
});

test("summarizeMoneyline averages odds across bookmakers", () => {
  const mk = (h: number) => ({
    key: "b",
    title: "B",
    last_update: "",
    markets: [
      {
        key: "h2h",
        outcomes: [
          { name: "Brazil", price: h },
          { name: "Draw", price: 4.0 },
          { name: "Serbia", price: 7.0 },
        ],
      },
    ],
  });
  const e = event({ bookmakers: [mk(1.4), mk(1.6)] });
  assert.equal(summarizeMoneyline(e).homeOdds, 1.5);
});

test("summarizeMoneyline returns nulls when a side is missing", () => {
  const e = event({
    bookmakers: [
      { key: "b", title: "B", last_update: "", markets: [{ key: "h2h", outcomes: [{ name: "Brazil", price: 1.5 }] }] },
    ],
  });
  const ml = summarizeMoneyline(e);
  assert.equal(ml.homeImpliedProb, null);
});

test("summarizeTotals picks the consensus (modal) line, not the first book's", () => {
  const book = (point: number) => ({
    key: "b",
    title: "B",
    last_update: "",
    markets: [
      {
        key: "totals",
        outcomes: [
          { name: "Over", price: 1.9, point },
          { name: "Under", price: 1.9, point },
        ],
      },
    ],
  });
  // First book hangs 3.5, but 2.5 is the consensus across the rest.
  const e = event({ bookmakers: [book(3.5), book(2.5), book(2.5)] });
  assert.equal(summarizeTotals(e).point, 2.5);
});

test("summarizeCorrectScore normalizes, ranks by implied prob, and parses 'h:a' names", () => {
  const e = event({
    bookmakers: [
      {
        key: "b",
        title: "B",
        last_update: "",
        markets: [
          {
            key: "correct_score",
            outcomes: [
              { name: "2:1", price: 8.0 },
              { name: "1 - 0", price: 6.0 }, // shortest odds => most likely
            ],
          },
        ],
      },
    ],
  });
  const cs = summarizeCorrectScore(e);
  assert.equal(cs[0].score, "1-0");
  assert.equal(cs[1].score, "2-1");
  const total = cs.reduce((s, c) => s + c.impliedProb, 0);
  assert.ok(Math.abs(total - 1) < 1e-9);
});

test("parseFinalScore only returns a score for completed matches with both teams", () => {
  const base: OddsApiScoreEntry = {
    id: "e",
    commence_time: "",
    completed: true,
    home_team: "Brazil",
    away_team: "Serbia",
    scores: [
      { name: "Brazil", score: "2" },
      { name: "Serbia", score: "1" },
    ],
  };
  assert.deepEqual(parseFinalScore(base), { homeGoals: 2, awayGoals: 1 });
  assert.equal(parseFinalScore({ ...base, completed: false }), null);
  assert.equal(parseFinalScore({ ...base, scores: null }), null);
  assert.equal(parseFinalScore({ ...base, scores: [{ name: "Brazil", score: "2" }] }), null);
});
