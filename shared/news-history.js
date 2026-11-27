import { mergeNewsArticles } from "./news.js";
const KEY = "tickr-news-history-v1";
const validSymbol = (value) =>
  typeof value === "string" &&
  /^(NSE|BSE):[A-Z0-9][A-Z0-9&_.!-]{0,39}$/.test(value);
function entries(storage, onlySymbol) {
  try {
    const data = JSON.parse(storage.getItem(KEY));
    if (data?.version !== 1 || !Array.isArray(data.entries)) return [];
    return data.entries
      .filter(
        (item) => validSymbol(item.symbol) && Array.isArray(item.articles),
      )
      .slice(0, 30)
      .filter((item) => onlySymbol == null || item.symbol === onlySymbol)
      .map((item) => ({
        ...item,
        articles: mergeNewsArticles(item.articles).slice(0, 200),
      }));
  } catch {
    return [];
  }
}
export function readNewsHistory(storage, symbol) {
  return (
    entries(storage, symbol).find((item) => item.symbol === symbol)?.articles || []
  );
}
export function saveNewsHistory(storage, symbol, articles) {
  if (!validSymbol(symbol)) return { articles: [], saved: false };
  const prior = entries(storage),
    merged = mergeNewsArticles(
      articles,
      prior.find((item) => item.symbol === symbol)?.articles || [],
    ).slice(0, 200);
  let remaining = 2000;
  const updated = [
    { symbol, articles: merged },
    ...prior.filter((item) => item.symbol !== symbol),
  ]
    .slice(0, 30)
    .map((item) => {
      const kept = item.articles.slice(0, remaining);
      remaining -= kept.length;
      return { ...item, articles: kept };
    })
    .filter((item) => item.articles.length);
  try {
    storage.setItem(KEY, JSON.stringify({ version: 1, entries: updated }));
    return { articles: merged, saved: true };
  } catch {
    return { articles: merged, saved: false };
  }
}
