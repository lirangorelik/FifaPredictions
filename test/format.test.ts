import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeMarkdownV2 } from "../src/bot/formatDailyAnalysis.js";

test("escapeMarkdownV2 escapes every Telegram MarkdownV2 special character", () => {
  // A backslash precedes each escaped char; team names and LLM free-text routinely contain these.
  assert.equal(escapeMarkdownV2("Côte d'Ivoire (group A)!"), "Côte d'Ivoire \\(group A\\)\\!");
  assert.equal(escapeMarkdownV2("2.5 goals - over"), "2\\.5 goals \\- over");
  assert.equal(escapeMarkdownV2("a_b*c"), "a\\_b\\*c");
});
