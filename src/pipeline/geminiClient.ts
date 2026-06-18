import { GoogleGenerativeAI } from "@google/generative-ai";
import { env } from "../config/env.js";
import { batchPredictionOutputSchema, geminiBatchResponseSchema, type BatchPredictionOutput } from "./predictionSchema.js";

const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);

export interface BatchPredictionWithRaw {
  output: BatchPredictionOutput;
  raw: unknown;
}

// 2 retries after the first attempt: wait 15s then 45s before giving up (~60s total headroom).
const RETRY_DELAYS_MS = [15_000, 45_000];

function isTransientGeminiError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /\[5\d{2}/.test(err.message) || err.message.includes("Service Unavailable") || err.message.includes("overloaded");
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * One Gemini call analyzing every match in the batch together (responseSchema constrains the
 * model to the array-of-predictions JSON contract), re-validated with zod before reaching the
 * database. This is the actual lever against free-tier daily request caps - N matches still cost
 * 1 Gemini request instead of N.
 *
 * Retries automatically on transient 5xx errors (e.g. 503 Service Unavailable) before giving up.
 */
export async function generateBatchPredictions(prompt: string): Promise<BatchPredictionWithRaw> {
  const model = genAI.getGenerativeModel({
    model: env.GEMINI_MODEL,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: geminiBatchResponseSchema,
    },
  });

  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const result = await model.generateContent(prompt);
      const text = result.response.text();

      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error(`Gemini returned non-JSON output: ${text}`);
      }

      const parsed = batchPredictionOutputSchema.safeParse(json);
      if (!parsed.success) {
        throw new Error(`Batch prediction failed schema validation: ${parsed.error.message}`);
      }

      return { output: parsed.data, raw: result.response };
    } catch (err) {
      lastErr = err;
      if (!isTransientGeminiError(err) || attempt === RETRY_DELAYS_MS.length) throw err;
      const delay = RETRY_DELAYS_MS[attempt];
      console.warn(`Gemini transient error (attempt ${attempt + 1}/${RETRY_DELAYS_MS.length + 1}), retrying in ${delay / 1000}s: ${err instanceof Error ? err.message : String(err)}`);
      await sleep(delay);
    }
  }

  throw lastErr;
}
