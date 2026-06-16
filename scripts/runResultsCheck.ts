import { checkFinishedMatches } from "../src/scheduler/resultsJob.js";

/** One-off manual test: runs the post-match results check immediately, without waiting for the cron cadence. */
checkFinishedMatches()
  .then(() => console.log("Results check complete."))
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
