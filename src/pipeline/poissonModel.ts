// Poisson scoreline model derived from market data. Pure and IO-free so it can be unit-tested.
//
// The betting game this feeds scores +1 point for the correct outcome (win/draw) and +3 points for
// the exact scoreline. For any candidate score s, expected points = P(outcome of s) + 2*P(exact=s)
// (the 3-pt exact case = 1 outcome point + 2 bonus). We build a Poisson scoreline distribution from
// the market's expected total goals and win probability, then pick the score that maximizes that.

const MAX_GOALS = 8;

// Weight on the exact-score term in expected points. 2 corresponds to "exact score is worth 3 total
// (1 outcome + 2 bonus)". If your game instead awards 3 ON TOP of the 1 outcome point, set this to 3.
const EXACT_SCORE_BONUS = 2;

export interface ScorelineProb {
  home: number;
  away: number;
  prob: number;
}

export interface PoissonModel {
  lambdaHome: number;
  lambdaAway: number;
  outcomeProbs: { home: number; draw: number; away: number };
  topScores: ScorelineProb[]; // most likely first
  /** Scoreline that maximizes expected game points under the 1-pt-outcome / 3-pt-exact scoring. */
  bestPointsScore: { home: number; away: number; expectedPoints: number };
}

function poissonPmf(k: number, lambda: number): number {
  let factorial = 1;
  for (let i = 2; i <= k; i++) factorial *= i;
  return (Math.exp(-lambda) * lambda ** k) / factorial;
}

function buildGrid(lambdaHome: number, lambdaAway: number): ScorelineProb[] {
  const homePmf = Array.from({ length: MAX_GOALS + 1 }, (_, h) => poissonPmf(h, lambdaHome));
  const awayPmf = Array.from({ length: MAX_GOALS + 1 }, (_, a) => poissonPmf(a, lambdaAway));
  const grid: ScorelineProb[] = [];
  let total = 0;
  for (let h = 0; h <= MAX_GOALS; h++) {
    for (let a = 0; a <= MAX_GOALS; a++) {
      const prob = homePmf[h] * awayPmf[a];
      grid.push({ home: h, away: a, prob });
      total += prob;
    }
  }
  // Renormalize: truncating at MAX_GOALS drops a tiny tail of probability mass.
  for (const g of grid) g.prob /= total;
  return grid;
}

function outcomeProbsFromGrid(grid: ScorelineProb[]): { home: number; draw: number; away: number } {
  let home = 0;
  let draw = 0;
  let away = 0;
  for (const g of grid) {
    if (g.home > g.away) home += g.prob;
    else if (g.home < g.away) away += g.prob;
    else draw += g.prob;
  }
  return { home, draw, away };
}

/**
 * Splits a fixed expected total into home/away scoring rates so the resulting Poisson model's
 * P(home win) matches the market. P(home win) rises monotonically as more of the total is given to
 * the home side, so a binary search converges cleanly.
 */
function fitLambdas(totalGoals: number, homeWinProb: number): { lambdaHome: number; lambdaAway: number } {
  let lo = 0.01;
  let hi = totalGoals - 0.01;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const modelled = outcomeProbsFromGrid(buildGrid(mid, totalGoals - mid)).home;
    if (modelled < homeWinProb) lo = mid;
    else hi = mid;
  }
  const lambdaHome = (lo + hi) / 2;
  return { lambdaHome, lambdaAway: totalGoals - lambdaHome };
}

export interface MarketInputs {
  totalsLine: number | null;
  homeImpliedProb: number | null;
}

/**
 * Builds a Poisson scoreline model from the market's goal-total line and vig-removed home-win
 * probability, then computes the expected-points-maximizing scoreline for the betting game.
 * Returns null when the required market inputs are missing (caller falls back to LLM-only).
 */
export function buildPoissonModel({ totalsLine, homeImpliedProb }: MarketInputs): PoissonModel | null {
  if (totalsLine == null || homeImpliedProb == null) return null;

  const total = Math.max(0.3, totalsLine);
  const clampedHomeProb = Math.min(0.98, Math.max(0.02, homeImpliedProb));
  const { lambdaHome, lambdaAway } = fitLambdas(total, clampedHomeProb);
  const grid = buildGrid(lambdaHome, lambdaAway);
  const outcomeProbs = outcomeProbsFromGrid(grid);

  let best = { home: 0, away: 0, expectedPoints: -1 };
  for (const g of grid) {
    const outcomeProb = g.home > g.away ? outcomeProbs.home : g.home < g.away ? outcomeProbs.away : outcomeProbs.draw;
    const expectedPoints = outcomeProb + EXACT_SCORE_BONUS * g.prob;
    if (expectedPoints > best.expectedPoints) {
      best = { home: g.home, away: g.away, expectedPoints };
    }
  }

  const topScores = [...grid].sort((a, b) => b.prob - a.prob).slice(0, 6);
  return { lambdaHome, lambdaAway, outcomeProbs, topScores, bestPointsScore: best };
}
