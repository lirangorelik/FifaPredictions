import { runLearning } from "../src/scheduler/learningJob.js";

runLearning()
  .then(() => console.log("Learning run complete."))
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
