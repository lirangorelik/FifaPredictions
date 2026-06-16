import express from "express";
import { findUpcomingMatches } from "../db/matchesRepo.js";
import { getLatestPrediction, getAccuracyStats } from "../db/predictionsRepo.js";
import { renderUpcomingPage, renderAccuracyPage, type UpcomingRow } from "./templates.js";

function sendError(res: express.Response, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  res.status(500).type("html").send(`<pre>${message}</pre>`);
}

export function createDashboardApp(): express.Express {
  const app = express();

  app.get("/", async (_req, res) => {
    try {
      const matches = await findUpcomingMatches(50);
      const rows: UpcomingRow[] = await Promise.all(
        matches.map(async (match) => ({ match, prediction: await getLatestPrediction(match.id) })),
      );
      res.type("html").send(renderUpcomingPage(rows));
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get("/accuracy", async (_req, res) => {
    try {
      const stats = await getAccuracyStats();
      res.type("html").send(renderAccuracyPage(stats));
    } catch (err) {
      sendError(res, err);
    }
  });

  return app;
}

export function startDashboard(port: number): void {
  const app = createDashboardApp();
  app.listen(port, () => {
    console.log(`Dashboard listening on http://localhost:${port}/`);
  });
}
