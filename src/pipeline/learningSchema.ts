import { SchemaType, type Schema } from "@google/generative-ai";
import { z } from "zod";

export const ERROR_TYPES = [
  "EXACT_SCORE",
  "CORRECT_OUTCOME_CLOSE",
  "CORRECT_OUTCOME_OFF",
  "WRONG_OUTCOME",
  "RIGHT_BUT_UNLUCKY",
] as const;

export const matchLearningSchema = z.object({
  match_label: z.string().min(1),
  error_type: z.enum(ERROR_TYPES),
  lesson: z.string().min(1),
});

export const batchLearningOutputSchema = z.object({
  learnings: z.array(matchLearningSchema),
});

export type MatchLearning = z.infer<typeof matchLearningSchema>;
export type BatchLearningOutput = z.infer<typeof batchLearningOutputSchema>;

/** Mirrors batchLearningOutputSchema, passed to Gemini's generationConfig.responseSchema. */
export const geminiLearningResponseSchema: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    learnings: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          match_label: {
            type: SchemaType.STRING,
            description: 'Must exactly equal the "Home vs Away" text shown in that match\'s "=== MATCH: ... ===" header.',
          },
          error_type: {
            type: SchemaType.STRING,
            enum: [...ERROR_TYPES],
            description:
              "EXACT_SCORE: nailed the exact scoreline. CORRECT_OUTCOME_CLOSE: right winner, total goals off by 1. CORRECT_OUTCOME_OFF: right winner, scoreline significantly off. WRONG_OUTCOME: wrong winner or draw. RIGHT_BUT_UNLUCKY: prediction was analytically sound but result defied probability (late penalty, own goal, red card).",
          },
          lesson: {
            type: SchemaType.STRING,
            description:
              "2-3 sentences. For wrong predictions: what was misread or under-weighted. For correct ones: what worked and why. For unlucky ones: why the analysis was sound despite the result. Must be actionable for future predictions.",
          },
        },
        required: ["match_label", "error_type", "lesson"],
      },
    },
  },
  required: ["learnings"],
};
