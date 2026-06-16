import { SchemaType, type Schema } from "@google/generative-ai";
import { z } from "zod";

export const matchPredictionSchema = z.object({
  match_label: z.string().min(1),
  predicted_outcome: z.enum(["HOME_WIN", "AWAY_WIN", "DRAW"]),
  predicted_home_goals: z.number().int().min(0).max(15),
  predicted_away_goals: z.number().int().min(0).max(15),
  confidence_score: z.number().int().min(1).max(10),
  market_consensus: z.string().min(1),
  analytical_edge: z.string().min(1),
});

export const batchPredictionOutputSchema = z.object({
  predictions: z.array(matchPredictionSchema),
});

export type MatchPrediction = z.infer<typeof matchPredictionSchema>;
export type BatchPredictionOutput = z.infer<typeof batchPredictionOutputSchema>;

/** Mirrors batchPredictionOutputSchema, passed to Gemini's generationConfig.responseSchema. */
export const geminiBatchResponseSchema: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    predictions: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          match_label: {
            type: SchemaType.STRING,
            description: 'Must exactly equal the "Home vs Away" text shown in that match\'s "=== MATCH N: ... ===" header, so it can be matched back to the right fixture.',
          },
          predicted_outcome: { type: SchemaType.STRING, enum: ["HOME_WIN", "AWAY_WIN", "DRAW"] },
          predicted_home_goals: { type: SchemaType.INTEGER, description: "Predicted goals for the home team. Realistic football scoreline, integer between 0 and 8." },
          predicted_away_goals: { type: SchemaType.INTEGER, description: "Predicted goals for the away team. Realistic football scoreline, integer between 0 and 8." },
          confidence_score: { type: SchemaType.INTEGER, description: "Confidence in this exact scoreline, on a scale from 1 (low) to 10 (high). Must be an integer from 1 to 10 inclusive, never higher." },
          market_consensus: { type: SchemaType.STRING, description: "One sentence summarizing what the betting markets indicate for this specific match." },
          analytical_edge: { type: SchemaType.STRING, description: "Two sentences on qualitative factors (injuries, tactics) that might defy or support the odds for this specific match." },
        },
        required: [
          "match_label",
          "predicted_outcome",
          "predicted_home_goals",
          "predicted_away_goals",
          "confidence_score",
          "market_consensus",
          "analytical_edge",
        ],
      },
    },
  },
  required: ["predictions"],
};
