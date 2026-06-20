import { runLearningPipeline } from "../pipeline/learningPipeline.js";
import { notifyAdmin } from "../bot/telegramService.js";

export async function runLearning(): Promise<void> {
  try {
    const count = await runLearningPipeline();
    if (count > 0) {
      console.log(`Learning complete: ${count} new lesson(s) saved.`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Learning pipeline failed:", message);
    await notifyAdmin(`⚠️ Learning pipeline failed: ${message}`);
    throw err;
  }
}
