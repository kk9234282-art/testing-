import React from "react";
import { ArrowUpRight, Layers } from "lucide-react";
import { publisherKey } from "../shared/news-quality.js";
const timestamp = (value) =>
  new Date(value).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  }) + " IST";
const shortTime = (value) =>
  new Date(value).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }) + " IST";
function Headline({ article, compact = false }) {
  const publisher = article.publisher || "Publisher unavailable";
  return (
    <div className={"news-story-content" + (compact ? " is-related" : "")}>
      <div className="news-story-meta">
        <span className="news-publisher-monogram" aria-hidden="true">
          {publisher
            .split(/\s+/)
            .map((word) => word[0])
            .join("")
            .slice(0, 2)
            .toUpperCase()}
        </span>
        <span
          className="news-story-publisher"
          title={article.via ? `Via ${article.via}` : publisher}
        >
          {publisher}
        </span>
        <time
          dateTime={article.publishedAt}
          title={timestamp(article.publishedAt)}
        >
          {shortTime(article.publishedAt)}
        </time>
      </div>
      {article.url ? (
        <a
          className="news-story-headline"
          href={article.url}
          target="_blank"
          rel="noreferrer"
        >
          {article.title}
          <ArrowUpRight size={14} aria-hidden="true" />
        </a>
      ) : (
        <b className="news-story-headline">{article.title}</b>
      )}
    </div>
  );
}
export default function NewsStory({ article }) {
  const related = article.relatedArticles || [];
  const otherSources = new Set(
    related
      .map((item) => publisherKey(item.publisher))
      .filter((key) => key !== publisherKey(article.publisher)),
  ).size;
  return (
    <article className="news-story-card">
      {article.category && (
        <span className="news-event-category" data-category={article.category}>
          {article.category}
        </span>
      )}
      <Headline article={article} />
      {related.length > 0 && (
        <details className="news-related">
          <summary>
            <Layers size={12} aria-hidden="true" />
            {otherSources
              ? `${otherSources} other source${otherSources === 1 ? "" : "s"} · `
              : ""}
            {related.length} related headline{related.length === 1 ? "" : "s"}
          </summary>
          <ul>
            {related.map((item, i) => (
              <li key={item.url || i}>
                <Headline article={item} compact />
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}
