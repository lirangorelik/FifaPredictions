import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPoissonModel } from "../src/pipeline/poissonModel.js";

test("returns null when market inputs are missing", () => {
  assert.equal(buildPoissonModel({ totalsLine: null, homeImpliedProb: 0.5 }), null);
  assert.equal(buildPoissonModel({ totalsLine: 2.5, homeImpliedProb: null }), null);
});

test("fits lambdas so model home-win probability matches the market input", () => {
  const m = buildPoissonModel({ totalsLine: 2.7, homeImpliedProb: 0.6 })!;
  assert.ok(Math.abs(m.outcomeProbs.home - 0.6) < 0.02, `home prob ${m.outcomeProbs.home}`);
  // Outcome probabilities form a distribution.
  const sum = m.outcomeProbs.home + m.outcomeProbs.draw + m.outcomeProbs.away;
  assert.ok(Math.abs(sum - 1) < 1e-6, `outcome probs sum ${sum}`);
  // Expected goals add up to (approximately) the totals line.
  assert.ok(Math.abs(m.lambdaHome + m.lambdaAway - 2.7) < 1e-6);
});

test("a heavy favourite gets more expected goals and a home-win optimal pick", () => {
  const m = buildPoissonModel({ totalsLine: 3.0, homeImpliedProb: 0.75 })!;
  assert.ok(m.lambdaHome > m.lambdaAway);
  assert.ok(m.outcomeProbs.home > m.outcomeProbs.away);
  assert.ok(m.bestPointsScore.home > m.bestPointsScore.away, "optimal pick should be a home win");
  assert.ok(m.bestPointsScore.expectedPoints > 0);
});

test("a balanced low-scoring match makes a draw competitive", () => {
  const m = buildPoissonModel({ totalsLine: 2.2, homeImpliedProb: 0.33 })!;
  // With no clear favourite and few goals, the draw should carry real weight.
  assert.ok(m.outcomeProbs.draw > 0.22, `draw prob ${m.outcomeProbs.draw}`);
});

test("topScores are sorted most-likely first and the optimal pick is among plausible scores", () => {
  const m = buildPoissonModel({ totalsLine: 2.6, homeImpliedProb: 0.5 })!;
  for (let i = 1; i < m.topScores.length; i++) {
    assert.ok(m.topScores[i - 1].prob >= m.topScores[i].prob);
  }
  // The optimal pick should be a low, realistic scoreline, not a blowout, for an even game.
  assert.ok(m.bestPointsScore.home <= 3 && m.bestPointsScore.away <= 3);
});
