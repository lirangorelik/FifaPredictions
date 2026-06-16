import { GoogleGenerativeAI } from "@google/generative-ai";
import { env } from "../config/env.js";
import { batchPredictionOutputSchema, geminiBatchResponseSchema, type BatchPredictionOutput } from "./predictionSchema.js";

const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);

export interface BatchPredictionWithRaw {
  output: BatchPredictionOutput;
  raw: unknown;
}

/**
 * One Gemini call analyzing every match in the batch together (responseSchema constrains the
 * model to the array-of-predictions JSON contract), re-validated with zod before reaching the
 * database. This is the actual lever against free-tier daily request caps - N matches still cost
 * 1 Gemini request instead of N.
 */
export async function generateBatchPredictions(prompt: string): Promise<BatchPredictionWithRaw> {
  const model = genAI.getGenerativeModel({
    model: env.GEMINI_MODEL,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: geminiBatchResponseSchema,
    },
  });

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
}
