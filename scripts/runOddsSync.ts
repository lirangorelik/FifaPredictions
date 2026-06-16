import { syncMatchesAndOdds } from "../src/scheduler/syncMatchesJob.js";

/** Standalone background odds-sync run - intended for an external scheduler (e.g. GitHub Actions cron). */
syncMatchesAndOdds()
  .then(() => console.log("Odds sync complete."))
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
