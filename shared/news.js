const finiteDate = (value) =>
  typeof value === "string" && Number.isFinite(Date.parse(value));
export function safeArticleUrl(value) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hostname === "localhost"
    )
      return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()])
      if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
    return url.href;
  } catch {
    return null;
  }
}
const plain = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
export function mergeNewsArticles(...lists) {
  const result = [],
    urls = new Map(),
    titles = new Map();
  for (const article of lists.flat()) {
    if (
      typeof article?.title !== "string" ||
      !article.title.trim() ||
      !finiteDate(article.publishedAt)
    )
      continue;
    const url = safeArticleUrl(article.url);
    if (!url) continue;
    const item = {
      title: article.title.slice(0, 500),
      publisher: String(article.publisher || "Publisher unavailable").slice(
        0,
        120,
      ),
      url,
      publishedAt: new Date(article.publishedAt).toISOString(),
      via: String(article.via || "Yahoo Finance").slice(0, 80),
    };
    const titleKey = plain(item.title) + "|" + plain(item.publisher);
    const previous = urls.get(url) ?? titles.get(titleKey);
    if (previous != null) continue;
    urls.set(url, result.length);
    titles.set(titleKey, result.length);
    result.push(item);
  }
  return result.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}
export function indiaNewsDay(publishedAt) {
  const time = Date.parse(publishedAt);
  return Number.isFinite(time)
    ? new Date(time + 19800000).toISOString().slice(0, 10)
    : null;
}
// Keep the publication day precise. Weekend/holiday news is not moved onto an
// earlier trading candle, which would imply the headline was known earlier.
export function groupChartNews(candles, articles) {
  const sessions = new Set(candles.map((item) => item.time)),
    groups = new Map();
  for (const article of articles || []) {
    const date = indiaNewsDay(article.publishedAt);
    if (!sessions.has(date)) continue;
    if (!groups.has(date)) groups.set(date, []);
    groups.get(date).push(article);
  }
  return [...groups]
    .map(([time, items]) => ({ time, articles: items }))
    .sort((a, b) => a.time.localeCompare(b.time));
}
