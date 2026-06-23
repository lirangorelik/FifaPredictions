import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveOutcome, matchPredictionSchema } from "../src/pipeline/predictionSchema.js";

test("deriveOutcome maps scorelines to W/D/L", () => {
  assert.equal(deriveOutcome(2, 0), "HOME_WIN");
  assert.equal(deriveOutcome(0, 3), "AWAY_WIN");
  assert.equal(deriveOutcome(1, 1), "DRAW");
});

test("schema overrides a model outcome that contradicts its own scoreline", () => {
  const parsed = matchPredictionSchema.parse({
    match_label: "Brazil vs Serbia",
    predicted_outcome: "AWAY_WIN", // contradicts the 2-1 scoreline below
    predicted_home_goals: 2,
    predicted_away_goals: 1,
    confidence_score: 7,
    market_consensus: "Brazil favoured.",
    analytical_edge: "Serbia missing defenders.",
  });
  assert.equal(parsed.predicted_outcome, "HOME_WIN");
});

test("schema rejects out-of-range confidence", () => {
  const result = matchPredictionSchema.safeParse({
    match_label: "A vs B",
    predicted_outcome: "DRAW",
    predicted_home_goals: 1,
    predicted_away_goals: 1,
    confidence_score: 11,
    market_consensus: "x",
    analytical_edge: "y",
  });
  assert.equal(result.success, false);
});
