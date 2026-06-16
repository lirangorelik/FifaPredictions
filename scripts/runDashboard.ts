import { env } from "../src/config/env.js";
import { startDashboard } from "../src/web/server.js";

/** Starts just the read-only dashboard, without the scheduler - the daily analysis/sync/results
 * jobs now run on GitHub Actions, so a local viewing session doesn't need to duplicate them. */
if (!env.DASHBOARD_PORT) {
  throw new Error("Set DASHBOARD_PORT in .env to use the dashboard.");
}
startDashboard(env.DASHBOARD_PORT);
