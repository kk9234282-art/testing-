import { indiaNewsDay } from "./news.js";
const normalize = (value) =>
  String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
export const publisherKey = (value) =>
  normalize(value || "Publisher unavailable");
const CATEGORIES = [
  [
    "Results",
    /\b(results?|earnings?|quarterly|q[1-4]|revenue|profits?|loss(?:es)?|eps)\b/i,
  ],
  ["Dividends", /\b(dividends?|ex.dividend|record date|payouts?)\b/i],
  [
    "Orders & contracts",
    /\b(orders?|contracts?|tenders?|awarded|bags?|secures?)\b/i,
  ],
  [
    "Corporate actions",
    /\b(acquisitions?|acquires?|acquired|mergers?|demergers?|buybacks?|stake sale|rights issue|fundrais\w*|share split|stock split|bonus issue|divest\w*)\b/i,
  ],
  [
    "Management",
    /\b(ceo|cfo|chairman|chairperson|directors?|resigns?|resigned|appointments?|appoints?|appointed)\b/i,
  ],
  [
    "Regulatory & legal",
    /\b(sebi|rbi|nclt|court|penalt\w*|fines?|fraud|investigat\w*|regulat\w*|filings?|approvals?|approved|notices?|insolvency)\b/i,
  ],
  [
    "Operations",
    /\b(plant|factory|production|shutdown|outage|recall|strike)\b/i,
  ],
];
const HARD_NOISE =
  /\b(price targets?|target price|price prediction|price forecast|should you buy|should you sell|buy before|buy ahead of|stock picks?|(?:buy|sell|hold) rating|stock tips?|technical analysis|intraday|multibagger|sponsored|advertorial|paid promotion|stocks? to (?:buy|watch)|shares? to buy|buy sell hold|buy or sell|support and resistance|share price (?:today|live)|stock price (?:today|live))\b/i;
const ROUNDUP =
  /\b(market roundup|market wrap|stocks? in focus|stocks? to watch|top (?:gainers?|losers?)|among \d+ stocks?)\b/i;
export function headlineRelevance(title, company) {
  const text = " " + normalize(title) + " ";
  const subject = (needle) => {
    const index = text.indexOf(" " + needle + " ");
    if (index < 0) return false;
    const before = text.slice(0, index);
    return (
      before.trim().split(/\s+/).filter(Boolean).length <= 12 &&
      !/\b(mentions?|including|among|led by|alongside|such as)\b/.test(before)
    );
  };
  const words = normalize(company?.name)
    .split(" ")
    .filter(
      (word) =>
        word &&
        !["limited", "ltd", "inc", "corporation", "corp"].includes(word),
    );
  const full = words.join(" ");
  if (full.length >= 4 && subject(full)) return true;
  const ticker = String(
    company?.symbol || company?.id?.split(":")[1] || "",
  ).toLowerCase();
  if (
    /^[a-z][a-z0-9]{2,20}$/.test(ticker) &&
    !["yes", "all", "bank", "india", "power", "auto"].includes(ticker) &&
    subject(ticker)
  )
    return true;
  // Two distinctive leading words admit common short company names, without
  // treating a shared first word (e.g. Adani or Tata) as sufficient identity.
  const prefix = words.slice(0, 2).join(" ");
  return (
    words.length >= 2 &&
    prefix.length >= 8 &&
    !["state bank", "bank of", "indian bank"].includes(prefix) &&
    subject(prefix)
  );
}
export function classifyHeadline(article, company) {
  const title = String(article?.title || "");
  const relevant = headlineRelevance(title, company);
  const category =
    CATEGORIES.find(([, pattern]) => pattern.test(title))?.[0] || null;
  const routineLossCoverage =
    category === "Results" &&
    /\b(?:shares?|stocks?)\b.*\blosses\b/i.test(title) &&
    !/\b(results?|earnings?|quarterly|q[1-4]|revenue|profits?|net loss)\b/i.test(
      title,
    );
  const lowValue =
    HARD_NOISE.test(title) || ROUNDUP.test(title) || routineLossCoverage;
  return {
    category,
    relevant,
    important: relevant && !!category && !lowValue,
    reason: !relevant
      ? "Company is not clearly the headline subject"
      : lowValue
        ? "Tips, promotion or routine market coverage"
        : category
          ? "Company event"
          : "General or routine coverage",
  };
}
const STOP = new Set(
  "a an the and or of in on for from at to with by after before as its it is are has have this that today latest update updates announces announced announce reports report reported posts posted declares declared net per percent rs inr crore crores cr".split(
    " ",
  ),
);
const SYNONYMS = {
  profits: "profit",
  earnings: "results",
  quarterly: "quarter",
  rises: "rise",
  rising: "rise",
  jumps: "rise",
  jump: "rise",
  surges: "rise",
  surge: "rise",
  grows: "rise",
  growth: "rise",
  increases: "rise",
  increase: "rise",
  falls: "fall",
  drops: "fall",
  drop: "fall",
  declines: "fall",
  decline: "fall",
  slumps: "fall",
  slump: "fall",
  wins: "win",
  won: "win",
  bags: "win",
  secures: "win",
  awarded: "win",
  contracts: "order",
  contract: "order",
  orders: "order",
};
function signature(article, company) {
  const title = normalize(article.title),
    companyWords = new Set(
      normalize(`${company?.name || ""} ${company?.symbol || ""}`).split(" "),
    );
  const tokens = new Set(
    title
      .split(" ")
      .filter((word) => word && !STOP.has(word) && !companyWords.has(word))
      .map((word) => (Object.hasOwn(SYNONYMS, word) ? SYNONYMS[word] : word)),
  );
  const numbers = [...String(article.title).matchAll(/\d+(?:[.,]\d+)*/g)]
    .map((match) => String(Number(match[0].replace(/,/g, ""))))
    .sort()
    .join("|");
  const periods = [...title.matchAll(/\bq[1-4]\b/g)].map((match) => match[0]);
  for (const [word, period] of [
    ["first", "q1"],
    ["second", "q2"],
    ["third", "q3"],
    ["fourth", "q4"],
  ])
    if (title.includes(word + " quarter")) periods.push(period);
  const units = [
    /%|\bpercent\b|\bper cent\b/i.test(article.title) ? "percent" : "",
    /₹|\b(?:rs|inr|rupees?)\b/i.test(article.title) ? "money" : "",
    /\b(?:crores?|cr)\b/i.test(article.title) ? "crore" : "",
    /\bmillions?\b/i.test(article.title) ? "million" : "",
    /\bbillions?\b/i.test(article.title) ? "billion" : "",
    /\blakhs?\b/i.test(article.title) ? "lakh" : "",
  ]
    .filter(Boolean)
    .join("|");
  const positive =
    /\b(rise|rises|rising|jump|jumps|surge|surges|grow|grows|growth|gain|gains|up|increase|increases|win|wins|won|bag|bags|secure|secures|secured|awarded|approve|approves|approved|approval)\b/.test(
      title,
    );
  const negative =
    /\b(fall|falls|falling|drop|drops|decline|declines|slump|slumps|down|cut|cuts|loss|losses|lose|loses|lost|cancel|cancels|cancelled|canceled|deny|denies|denied|reject|rejects|rejected|fails|scrapped)\b/.test(
      title,
    );
  return {
    title,
    tokens,
    numbers,
    periods: [...new Set(periods)].sort().join("|"),
    units,
    direction:
      positive && negative
        ? "mixed"
        : positive
          ? "positive"
          : negative
            ? "negative"
            : "none",
  };
}
function similar(a, b) {
  if (
    a.day !== b.day ||
    a.info.category !== b.info.category ||
    a.info.relevant !== b.info.relevant
  )
    return false;
  if (a.sig.periods && b.sig.periods && a.sig.periods !== b.sig.periods)
    return false;
  if (a.sig.numbers && b.sig.numbers && a.sig.numbers !== b.sig.numbers)
    return false;
  if (
    a.sig.numbers &&
    b.sig.numbers &&
    a.sig.units &&
    b.sig.units &&
    a.sig.units !== b.sig.units
  )
    return false;
  if (
    a.sig.direction !== "none" &&
    b.sig.direction !== "none" &&
    a.sig.direction !== b.sig.direction
  )
    return false;
  if (a.sig.title === b.sig.title) return true;
  const common = [...a.sig.tokens].filter((token) =>
    b.sig.tokens.has(token),
  ).length;
  const union = new Set([...a.sig.tokens, ...b.sig.tokens]).size;
  return common >= 3 && union > 0 && common / union >= 0.68;
}
// Filters are a view of the archive; no original headlines are deleted.
export function selectQualityNews(
  articles,
  company,
  { mode = "important", publishers = null } = {},
) {
  const valid = (articles || []).filter(
    (item) => typeof item?.title === "string" && indiaNewsDay(item.publishedAt),
  );
  const allowed = publishers == null ? null : new Set(publishers);
  const publisherMatches = valid.filter(
    (item) => !allowed || allowed.has(publisherKey(item.publisher)),
  );
  const candidates = publisherMatches
    .map((article) => ({
      article,
      day: indiaNewsDay(article.publishedAt),
      info: classifyHeadline(article, company),
      sig: signature(article, company),
    }))
    .filter((item) => mode === "all" || item.info.important)
    .sort((a, b) => b.article.publishedAt.localeCompare(a.article.publishedAt));
  const groups = [];
  for (const item of candidates) {
    const group = groups.find((group) => similar(group.lead, item));
    if (group) group.items.push(item.article);
    else groups.push({ lead: item, items: [item.article] });
  }
  const stories = groups.map(({ lead, items }) => ({
    ...lead.article,
    category: lead.info.category || "General",
    relatedArticles: items.slice(1),
  }));
  return {
    stories,
    total: valid.length,
    publisherMatches: publisherMatches.length,
    qualifying: candidates.length,
    grouped: candidates.length - stories.length,
  };
}
