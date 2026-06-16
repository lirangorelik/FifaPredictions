import { env } from "./config/env.js";
import { startScheduler } from "./scheduler/scheduler.js";
import { startDashboard } from "./web/server.js";

console.log(`Loaded environment for sport: ${env.ODDS_API_SPORT_KEY}, model: ${env.GEMINI_MODEL}`);
startScheduler();

if (env.DASHBOARD_PORT) {
  startDashboard(env.DASHBOARD_PORT);
}
