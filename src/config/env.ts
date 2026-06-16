import "dotenv/config";
import { z } from "zod";

// Empty-string env vars (e.g. "DATABASE_URL=" with no value) should be treated as unset, not as a validation failure.
const optionalNonEmpty = () =>
  z.preprocess((v) => (v === "" ? undefined : v), z.string().min(1).optional());

const envSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  DATABASE_URL: optionalNonEmpty(),

  ODDS_API_KEY: z.string().min(1),
  ODDS_API_SPORT_KEY: z.string().min(1).default("soccer_fifa_world_cup"),

  TAVILY_API_KEY: z.string().min(1),

  GEMINI_API_KEY: z.string().min(1),
  GEMINI_MODEL: z.string().min(1).default("gemini-2.5-flash"),

  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_CHAT_ID: z.string().min(1),
  TELEGRAM_ADMIN_CHAT_ID: optionalNonEmpty(),

  POLL_INTERVAL_CRON: z.string().min(1).default("*/5 * * * *"),

  // Background odds sync cadence - just keeps the match schedule/odds reasonably fresh between
  // daily analysis runs. The daily analysis job also triggers its own sync immediately before
  // analyzing, so this only needs to be "not too stale," not real-time.
  SLOW_SYNC_INTERVAL_MINUTES: z.coerce.number().positive().default(180),

  RESULTS_CHECK_INTERVAL_MINUTES: z.coerce.number().positive().default(30),

  // One consolidated full-analysis message per day covering every match in the next 24h,
  // generated via a single Gemini call (not one call per match) to conserve free-tier quota.
  DAILY_ANALYSIS_CRON: z.string().min(1).default("0 17 * * *"),
  DAILY_ANALYSIS_TIMEZONE: z.string().min(1).default("Asia/Jerusalem"),
  // Safety net against duplicate analysis if the job is retried/restarted - skip a match that
  // already has a prediction newer than this many hours.
  BATCH_DEDUPE_HOURS: z.coerce.number().positive().default(20),

  // Optional - if unset, the read-only dashboard doesn't start (opt-in, personal-use tool).
  DASHBOARD_PORT: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().int().positive().optional()),
});

function loadEnv() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid/missing environment variables:\n${issues}\n\nCopy .env.example to .env and fill in the required keys.`);
  }
  return parsed.data;
}

export const env = loadEnv();
export type Env = typeof env;
