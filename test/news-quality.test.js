import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyHeadline,
  headlineRelevance,
  selectQualityNews,
  publisherKey,
} from "../shared/news-quality.js";
const company = {
  name: "Tata Consultancy Services Ltd.",
  symbol: "TCS",
  id: "NSE:TCS",
};
const story = (title, extra = {}) => ({
  title,
  publisher: "Moneycontrol",
  publishedAt: "2025-02-01T09:00:00Z",
  url: "https://example.com/" + encodeURIComponent(title),
  ...extra,
});
test("important mode keeps company events including negative results and legal news", () => {
  for (const title of [
    "TCS reports Q3 profit falls 10%",
    "TCS declares dividend of Rs 20",
    "TCS wins major contract",
    "TCS acquires consulting firm",
    "TCS appoints new CEO",
    "SEBI fines TCS over delayed filings",
  ])
    assert.equal(
      classifyHeadline(story(title), company).important,
      true,
      title,
    );
});
test("tips, promotions, routine price moves and passing mentions stay in All news", () => {
  const titles = [
    "TCS share price today: stock gains 2%",
    "TCS stock price target before earnings",
    "Sponsored: TCS quarterly results guide",
    "TCS among 10 stocks to watch today",
    "Market roundup including TCS quarterly results",
    "Should you buy TCS before earnings?",
    "TCS shares rise 2%",
  ];
  const articles = titles.map((title) => story(title));
  assert.equal(selectQualityNews(articles, company).stories.length, 0);
  assert.equal(
    selectQualityNews(articles, company, { mode: "all" }).qualifying,
    titles.length,
  );
  assert.equal(
    headlineRelevance(
      "Market news including Tata Consultancy Services results",
      company,
    ),
    false,
  );
  assert.equal(
    headlineRelevance("Tata Power announces results", {
      name: "Tata Consultancy Services Ltd.",
      symbol: "TCS",
    }),
    false,
  );
});
test("similar same-day paraphrases group while original links remain expandable", () => {
  const first = story("TCS posts Q3 net profit jumps 10%");
  const second = story("TCS reports Q3 profit rises 10 percent", {
    publisher: "Reuters",
    url: "https://example.com/other",
    publishedAt: "2025-02-01T08:00:00Z",
  });
  const data = selectQualityNews([first, second], company);
  assert.equal(data.stories.length, 1);
  assert.equal(data.grouped, 1);
  assert.equal(data.stories[0].relatedArticles[0].url, second.url);
  assert.equal(data.stories[0].url, first.url);
  assert.equal(
    first.relatedArticles,
    undefined,
    "Raw archive objects are not changed",
  );
});
test("different quarters, values, directions, event types or IST days do not collapse", () => {
  const base = story("TCS Q3 profit rises 10%");
  for (const article of [
    story("TCS Q2 profit rises 10%"),
    story("TCS Q3 profit rises 20%"),
    story("TCS Q3 profit falls 10%"),
    story("TCS declares dividend of 10%"),
    story(base.title, { publishedAt: "2025-02-02T09:00:00Z" }),
  ]) {
    assert.equal(
      selectQualityNews([base, article], company).stories.length,
      2,
      article.title + " " + article.publishedAt,
    );
  }
});
test("publisher selection happens before grouping and supports an empty selection", () => {
  const a = story("TCS announces quarterly results");
  const b = story(a.title, {
    publisher: "Reuters",
    url: "https://example.com/other",
    publishedAt: "2025-02-01T08:00:00Z",
  });
  const data = selectQualityNews([a, b], company, {
    publishers: [publisherKey("Reuters")],
  });
  assert.equal(data.stories.length, 1);
  assert.equal(data.stories[0].publisher, "Reuters");
  assert.equal(data.stories[0].relatedArticles.length, 0);
  assert.equal(
    selectQualityNews([a, b], company, { publishers: [] }).stories.length,
    0,
  );
});
test("all mode still groups duplicates and excludes malformed dates", () => {
  const a = story("TCS stock tips today");
  const data = selectQualityNews(
    [
      a,
      { ...a, publisher: "Other", url: "https://example.com/tip" },
      story("TCS results", { publishedAt: "invalid" }),
    ],
    company,
    { mode: "all" },
  );
  assert.equal(data.stories.length, 1);
  assert.equal(data.total, 2);
  assert.equal(data.stories[0].relatedArticles.length, 1);
});

test("different financial units and opposite approval outcomes remain distinct", () => {
  assert.equal(
    selectQualityNews(
      [story("TCS profit rises 10%"), story("TCS profit rises Rs 10 crore")],
      company,
    ).stories.length,
    2,
  );
  assert.equal(
    selectQualityNews(
      [
        story("RBI approves TCS central bank contract scheme"),
        story("RBI denies TCS central bank contract scheme"),
      ],
      company,
    ).stories.length,
    2,
  );
});

test("written quarter names are distinct and routine stock losses are not earnings", () => {
  const stories = [
    story("TCS first quarter results profit rises 10%"),
    story("TCS second quarter results profit rises 10%"),
  ];
  assert.equal(selectQualityNews(stories, company).stories.length, 2);
  assert.equal(
    classifyHeadline(story("TCS shares extend losses for second day"), company)
      .important,
    false,
  );
  assert.equal(
    classifyHeadline(story("TCS shares fall after quarterly net loss"), company)
      .important,
    true,
  );
});
