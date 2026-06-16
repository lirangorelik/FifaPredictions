import { runDailyAnalysis } from "../src/scheduler/dailyAnalysisJob.js";

/** One-off manual test: runs the daily full-analysis batch immediately, without waiting for the cron cadence. */
runDailyAnalysis()
  .then(() => console.log("Daily analysis test complete."))
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
