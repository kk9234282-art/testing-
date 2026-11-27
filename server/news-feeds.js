import { XMLParser, XMLValidator } from "fast-xml-parser";
import { mergeNewsArticles, safeArticleUrl } from "../shared/news.js";
import { parseCompanyNews } from "./company-data.js";
const parser = new XMLParser({
  ignoreAttributes: false,
  processEntities: false,
  trimValues: true,
});
const text = (value) =>
  typeof value === "string"
    ? value
    : typeof value?.["#text"] === "string"
      ? value["#text"]
      : "";
const decode = (value) =>
  text(value).replace(
    /&(?:amp|lt|gt|quot|apos);/g,
    (entity) =>
      ({
        "&amp;": "&",
        "&lt;": "<",
        "&gt;": ">",
        "&quot;": '"',
        "&apos;": "'",
      })[entity],
  );
const normal = (value) =>
  value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
export function newsCompanyName(name) {
  return String(name || "")
    .replace(/\b(?:limited|ltd|inc|corporation|corp)\.?\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}
export function matchesNewsCompany(title, name, ticker) {
  const needle = normal(newsCompanyName(name)),
    haystack = " " + normal(title) + " ";
  if (needle.length >= 6 && haystack.includes(" " + needle + " ")) return true;
  // Short/common ticker words cause false matches; use the full company name.
  if (
    !/^[A-Z][A-Z0-9]{2,20}$/.test(ticker) ||
    ["ALL", "YES", "INDIA", "BANK", "POWER", "AUTO"].includes(ticker)
  )
    return false;
  return new RegExp(`(^|[^A-Za-z0-9])${ticker}([^A-Za-z0-9]|$)`).test(title);
}
export function parseNewsRss(xml, { feed, name, ticker, now = Date.now() }) {
  if (
    typeof xml !== "string" ||
    xml.length > 1000000 ||
    /<!DOCTYPE|<!ENTITY/i.test(xml)
  )
    throw new Error("Invalid RSS");
  if (XMLValidator.validate(xml) !== true) throw new Error("Malformed RSS");
  const channel = parser.parse(xml)?.rss?.channel;
  if (!channel || !channel.title) throw new Error("RSS channel unavailable");
  const items =
    channel.item == null
      ? []
      : Array.isArray(channel.item)
        ? channel.item
        : [channel.item];
  const articles = items.flatMap((item) => {
    const title = decode(item.title),
      url = safeArticleUrl(decode(item.link)),
      published = Date.parse(text(item.pubDate));
    if (
      !title ||
      !url ||
      !Number.isFinite(published) ||
      published > now + 86400000 ||
      !matchesNewsCompany(title, name, ticker)
    )
      return [];
    const publisher =
      feed === "Moneycontrol RSS"
        ? "Moneycontrol"
        : decode(item.source) || "Publisher unavailable";
    return [
      {
        title:
          feed === "Google News RSS" && publisher !== "Publisher unavailable"
            ? title.replace(
                new RegExp(
                  " - " +
                    publisher.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
                    "$",
                ),
                "",
              )
            : title,
        publisher,
        url,
        publishedAt: new Date(published).toISOString(),
        via: feed,
      },
    ];
  });
  return mergeNewsArticles(articles);
}
export function createNewsLoader({
  fetchData = globalThis.fetch,
  now = Date.now,
} = {}) {
  let moneycontrol = null,
    pendingMoneycontrol = null;
  const get = async (url) => {
    const response = await fetchData(url, {
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "Tickr personal research RSS reader" },
    });
    if (!response.ok) throw new Error("Feed unavailable");
    return response;
  };
  const mcFeed = async () => {
    if (moneycontrol && now() < moneycontrol.expires) {
      if (moneycontrol.error) throw new Error("RSS unavailable");
      return moneycontrol.xml;
    }
    if (!pendingMoneycontrol)
      pendingMoneycontrol = (async () => {
        try {
          const xml = await (
            await get("https://www.moneycontrol.com/rss/business.xml")
          ).text();
          parseNewsRss(xml, {
            feed: "Moneycontrol RSS",
            name: "",
            ticker: "",
            now: now(),
          });
          moneycontrol = { xml, expires: now() + 900000 };
          return xml;
        } catch (error) {
          moneycontrol = { error: true, expires: now() + 900000 };
          throw error;
        }
      })().finally(() => {
        pendingMoneycontrol = null;
      });
    return pendingMoneycontrol;
  };
  return async ({ providerSymbol, ticker, name, onProgress }) => {
    const definitions = [
      [
        "Yahoo Finance",
        async () => {
          const data = parseCompanyNews(
            await (
              await get(
                `https://query1.finance.yahoo.com/v1/finance/search?${new URLSearchParams({ q: providerSymbol, quotesCount: "0", newsCount: "15" })}`,
              )
            ).json(),
            providerSymbol,
          );
          return data.articles.map((item) => ({
            ...item,
            via: "Yahoo Finance",
          }));
        },
      ],
      [
        "Moneycontrol RSS",
        async () =>
          parseNewsRss(await mcFeed(), {
            feed: "Moneycontrol RSS",
            name,
            ticker,
            now: now(),
          }),
      ],
      [
        "Google News RSS",
        async () => {
          const query = newsCompanyName(name) || ticker;
          const xml = await (
            await get(
              `https://news.google.com/rss/search?${new URLSearchParams({ q: `"${query.replace(/["\\]/g, " ")}" stock`, hl: "en-IN", gl: "IN", ceid: "IN:en" })}`,
            )
          ).text();
          return parseNewsRss(xml, {
            feed: "Google News RSS",
            name,
            ticker,
            now: now(),
          });
        },
      ],
    ];
    const outcomes = definitions.map(([source]) => ({ source, status: "pending", articles: [] }));
    const snapshot = () => ({
      articles: mergeNewsArticles(...outcomes.map((item) => item.articles)).slice(0, 100),
      sources: outcomes.map(({ source, status, articles }) => ({ source, status, count: articles.length })),
      allSourcesUnavailable: outcomes.every((item) => item.status === "unavailable"),
    });
    await Promise.all(definitions.map(async ([source, load], index) => {
      try {
        outcomes[index] = { source, status: "available", articles: await load() };
      } catch {
        outcomes[index] = { source, status: "unavailable", articles: [] };
      }
      // A disconnected/failed subscriber must not change a source's outcome.
      try { onProgress?.(snapshot()); } catch {}
    }));
    return snapshot();
  };
}
