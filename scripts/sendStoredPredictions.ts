import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const BASE_URL = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID!;

function esc(text: string | number): string {
  return String(text).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (c) => "\\" + c);
}
function pct(v: number | null): string {
  return v == null ? "n/a" : `${(v * 100).toFixed(1)}%`;
}

async function main() {
  const now = new Date();
  const window48 = new Date(now.getTime() + 48 * 60 * 60 * 1000);

  const { data: matches } = await supabase
    .from("matches")
    .select("*, home_team:home_team_id(name), away_team:away_team_id(name)")
    .eq("status", "scheduled")
    .gte("kickoff_time", now.toISOString())
    .lt("kickoff_time", window48.toISOString())
    .order("kickoff_time", { ascending: true });

  const results: { match: any; prediction: any; odds: any }[] = [];
  for (const m of matches ?? []) {
    const { data: pred } = await supabase
      .from("predictions")
      .select("*")
      .eq("match_id", m.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!pred) {
      console.log(`No prediction yet for ${m.home_team.name} vs ${m.away_team.name}, skipping.`);
      continue;
    }
    const { data: odds } = await supabase
      .from("odds_snapshots")
      .select("*")
      .eq("match_id", m.id)
      .order("captured_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    results.push({ match: m, prediction: pred, odds });
  }

  if (results.length === 0) {
    console.log("No predictions to send.");
    return;
  }

  function formatBlock(r: { match: any; prediction: any; odds: any }): string {
    const home = esc(r.match.home_team.name);
    const away = esc(r.match.away_team.name);
    const kickoff = esc(
      new Date(r.match.kickoff_time).toLocaleString("en-GB", { timeZone: "UTC", dateStyle: "short", timeStyle: "short" }),
    );
    const p = r.prediction;
    const o = r.odds;
    const lines = [
      `⚽ *${home} vs ${away}*`,
      `⏰ Kickoff: ${kickoff} UTC`,
      `🎯 *PREDICTED SCORELINE:* *${home} ${p.predicted_home_goals} — ${p.predicted_away_goals} ${away}*`,
      `🎲 *Confidence:* ${esc(p.confidence_score)}/10`,
      `📊 *Market Consensus:* ${esc(p.market_consensus)}`,
      `🧠 *Analytical Edge:* ${esc(p.analytical_edge)}`,
    ];
    if (o?.polymarket_home_prob != null) {
      lines.push(
        `🪙 *Polymarket:* ${esc(`Home ${pct(o.polymarket_home_prob)} / Draw ${pct(o.polymarket_draw_prob)} / Away ${pct(o.polymarket_away_prob)}`)}`,
      );
    }
    return lines.join("\n");
  }

  const LIMIT = 3800;
  const header = `🚨 *WORLD CUP DAILY ANALYSIS* 🚨\n${esc(results.length)} matches \\(next 48h\\)`;
  const blocks = results.map(formatBlock);
  const messages: string[] = [];
  let current = header;
  for (const block of blocks) {
    const candidate = `${current}\n\n${block}`;
    if (candidate.length > LIMIT && current !== header) {
      messages.push(current);
      current = `${header} \\(cont'd\\)\n\n${block}`;
    } else {
      current = candidate;
    }
  }
  messages.push(current);

  for (const msg of messages) {
    const res = await fetch(`${BASE_URL}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: CHAT_ID, text: msg, parse_mode: "MarkdownV2" }),
    });
    const json = (await res.json()) as { ok: boolean; description?: string };
    if (!json.ok) {
      console.error("Telegram error:", json.description);
    } else {
      console.log("Sent message OK");
    }
  }
  console.log(`Done. Sent ${messages.length} message(s) covering ${results.length} matches.`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
