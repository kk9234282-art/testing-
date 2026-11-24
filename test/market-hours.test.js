import test from "node:test";
import assert from "node:assert/strict";
import {
  isMarketHours,
  shouldRefreshSummary,
  SUMMARY_REFRESH_MS,
} from "../shared/market-hours.js";
test("regular sessions use IST boundaries independently of the host timezone", () => {
  for (const [date, expected] of [
    ["2026-11-24T03:44:59Z", false],
    ["2026-11-24T03:45:00Z", true],
    ["2026-11-24T09:59:59Z", true],
    ["2026-11-24T10:00:00Z", false],
    ["2026-11-28T05:00:00Z", false],
    ["2026-11-29T05:00:00Z", false],
    ["2026-11-30T03:45:00Z", true],
  ])
    assert.equal(isMarketHours(Date.parse(date)), expected, date);
});
test("automatic refresh is due only after fifteen minutes within the session", () => {
  const open = Date.parse("2026-11-24T04:00:00Z");
  assert.equal(
    shouldRefreshSummary(open, open - SUMMARY_REFRESH_MS + 1),
    false,
  );
  assert.equal(shouldRefreshSummary(open, open - SUMMARY_REFRESH_MS), true);
  assert.equal(
    shouldRefreshSummary(Date.parse("2026-11-24T12:00:00Z"), open),
    false,
  );
  assert.equal(
    shouldRefreshSummary(Date.parse("2026-11-25T03:45:00Z"), open),
    true,
  );
});
