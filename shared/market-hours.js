export const SUMMARY_REFRESH_MS = 15 * 60 * 1000;
// NSE/BSE regular weekday session. Exchange holidays and special sessions
// require an exchange calendar and are not inferred from the clock.
export function isMarketHours(time = Date.now()) {
  const date = new Date(Number(time) + 330 * 60 * 1000);
  const day = date.getUTCDay();
  const minute = date.getUTCHours() * 60 + date.getUTCMinutes();
  return day >= 1 && day <= 5 && minute >= 555 && minute < 930;
}
export function shouldRefreshSummary(time, lastAttempt) {
  return isMarketHours(time) && time - lastAttempt >= SUMMARY_REFRESH_MS;
}
