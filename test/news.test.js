import test from "node:test";
import assert from "node:assert/strict";
import {
  parseNewsRss,
  matchesNewsCompany,
  createNewsLoader,
} from "../server/news-feeds.js";
import {
  mergeNewsArticles,
  groupChartNews,
  indiaNewsDay,
} from "../shared/news.js";
import { readNewsHistory, saveNewsHistory } from "../shared/news-history.js";
const clock = Date.parse("2025-02-02T09:00:00Z");
const article = (i = 1) => ({
  title: `TCS quarterly update ${i}`,
  publisher: "Moneycontrol",
  publishedAt: `2025-02-01T0${i % 9}:00:00Z`,
  url: `https://www.moneycontrol.com/news/${i}.html`,
  via: "Moneycontrol RSS",
});
const rss = (
  title = "TCS quarterly update",
  link = "https://www.moneycontrol.com/news/1.html",
  source = "",
) =>
  `<rss><channel><title>Business headlines</title><item><title><![CDATA[${title}]]></title><link>${link}</link><pubDate>Sat, 01 Feb 2025 09:00:00 GMT</pubDate>${source}</item></channel></rss>`;
const memory = () => ({
  value: null,
  getItem() {
    return this.value;
  },
  setItem(key, value) {
    this.value = value;
  },
});
test("RSS parses only matching company headlines, decodes entities and preserves dates/publishers", () => {
  const items = parseNewsRss(
    rss("Tata Consultancy Services revenue &amp; profits"),
    {
      feed: "Moneycontrol RSS",
      name: "Tata Consultancy Services Ltd.",
      ticker: "TCS",
      now: clock,
    },
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "Tata Consultancy Services revenue & profits");
  assert.equal(items[0].publisher, "Moneycontrol");
  assert.equal(items[0].publishedAt, "2025-02-01T09:00:00.000Z");
  assert.deepEqual(
    parseNewsRss(rss("Another company update"), {
      feed: "Moneycontrol RSS",
      name: "Tata Consultancy Services",
      ticker: "TCS",
      now: clock,
    }),
    [],
  );
  const google = parseNewsRss(
    rss(
      "TCS quarterly update - Moneycontrol",
      "https://news.google.com/rss/articles/abc",
      '<source url="https://www.moneycontrol.com">Moneycontrol</source>',
    ),
    {
      feed: "Google News RSS",
      name: "Tata Consultancy Services",
      ticker: "TCS",
      now: clock,
    },
  );
  assert.equal(google[0].title, "TCS quarterly update");
  assert.equal(google[0].publisher, "Moneycontrol");
  assert.equal(google[0].via, "Google News RSS");
  assert.equal(
    matchesNewsCompany("Stocks rally, yes they do", "Yes Bank Ltd.", "YES"),
    false,
  );
  assert.equal(
    matchesNewsCompany(
      "TCS announces results",
      "Tata Consultancy Services",
      "TCS",
    ),
    true,
  );
});
test("RSS rejects entity declarations, HTML error pages, unsafe links and bad dates", () => {
  const options = {
    feed: "Moneycontrol RSS",
    name: "TCS",
    ticker: "TCS",
    now: clock,
  };
  assert.throws(() =>
    parseNewsRss('<!DOCTYPE rss [<!ENTITY a "value">]>' + rss(), options),
  );
  assert.throws(() =>
    parseNewsRss("<html><title>Blocked</title></html>", options),
  );
  assert.deepEqual(
    parseNewsRss(rss("TCS update", "javascript:alert(1)"), options),
    [],
  );
  assert.deepEqual(
    parseNewsRss(
      rss().replace("Sat, 01 Feb 2025 09:00:00 GMT", "nonsense"),
      options,
    ),
    [],
  );
  assert.deepEqual(parseNewsRss(rss().replace("2025", "2035"), options), []);
});
test("feed aggregation keeps partial successes and shares the Moneycontrol RSS cache across companies", async () => {
  let mcCalls = 0;
  const loader = createNewsLoader({
    now: () => clock,
    fetchData: async (url) => {
      if (url.includes("moneycontrol.com")) {
        mcCalls++;
        return { ok: true, text: async () => rss() };
      }
      if (url.includes("news.google.com"))
        return {
          ok: true,
          text: async () =>
            rss(
              "TCS quarterly update - Moneycontrol",
              "https://news.google.com/rss/articles/abc",
              "<source>Moneycontrol</source>",
            ),
        };
      return { ok: false, status: 429 };
    },
  });
  const first = await loader({
    providerSymbol: "TCS.NS",
    ticker: "TCS",
    name: "Tata Consultancy Services Ltd.",
  });
  assert.equal(first.allSourcesUnavailable, false);
  assert.equal(first.sources[0].status, "unavailable");
  assert.equal(first.articles.length, 1);
  await loader({
    providerSymbol: "OTHER.NS",
    ticker: "OTHER",
    name: "Other Company Ltd.",
  });
  assert.equal(mcCalls, 1);
});
test("news merges sources without duplicate tracked URLs or same publisher/headline", () => {
  const first = article();
  const merged = mergeNewsArticles(
    [first, { ...first, url: first.url + "?utm_source=rss" }],
    [
      {
        ...first,
        url: "https://news.google.com/rss/articles/abc",
        via: "Google News RSS",
      },
    ],
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].url, first.url);
  assert.deepEqual(
    mergeNewsArticles([
      { ...first, url: "javascript:alert(1)" },
      { ...first, publishedAt: "invalid" },
    ]),
    [],
  );
});
test("news markers use exact IST publication dates without shifting weekend or out-of-range stories", () => {
  assert.equal(indiaNewsDay("2025-02-01T20:00:00Z"), "2025-02-02");
  const candle = [{ time: "2025-01-31" }, { time: "2025-02-03" }];
  const groups = groupChartNews(candle, [
    article(),
    { ...article(2), publishedAt: "2025-02-03T04:00:00Z" },
    { ...article(3), publishedAt: "2025-02-03T08:00:00Z" },
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].time, "2025-02-03");
  assert.equal(groups[0].articles.length, 2);
});
test("local history merges across sessions and companies without erasing saved stories on an empty fetch", () => {
  const storage = memory();
  assert.equal(saveNewsHistory(storage, "NSE:TCS", [article()]).saved, true);
  saveNewsHistory(storage, "BSE:1", [article(3)]);
  saveNewsHistory(storage, "NSE:TCS", [article(), article(2)]);
  assert.equal(readNewsHistory(storage, "NSE:TCS").length, 2);
  assert.equal(readNewsHistory(storage, "BSE:1").length, 1);
  saveNewsHistory(storage, "NSE:TCS", []);
  assert.equal(readNewsHistory(storage, "NSE:TCS").length, 2);
  const bounded = saveNewsHistory(
    storage,
    "NSE:TCS",
    Array.from({ length: 250 }, (_, i) => article(i)),
  );
  assert.equal(bounded.articles.length, 200);
});
test("corrupt or unavailable browser storage cannot break news rendering", () => {
  const storage = memory();
  storage.value = "{bad";
  assert.deepEqual(readNewsHistory(storage, "NSE:TCS"), []);
  const blocked = {
    getItem() {
      throw new Error("denied");
    },
    setItem() {
      throw new Error("quota");
    },
  };
  const result = saveNewsHistory(blocked, "NSE:TCS", [article()]);
  assert.equal(result.saved, false);
  assert.equal(result.articles.length, 1);
  assert.deepEqual(readNewsHistory(blocked, "NSE:TCS"), []);
});

test("news history bounds the full archive across many companies", () => {
  const storage = memory();
  for (let i = 0; i < 35; i++)
    saveNewsHistory(
      storage,
      `NSE:T${i}`,
      Array.from({ length: 100 }, (_, j) => article(i * 100 + j)),
    );
  const stored = JSON.parse(storage.value).entries;
  assert(stored.length <= 30);
  assert(
    stored.reduce((total, item) => total + item.articles.length, 0) <= 2000,
  );
  assert.equal(stored[0].symbol, "NSE:T34");
});
