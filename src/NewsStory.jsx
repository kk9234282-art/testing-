import React from "react";
import { publisherKey } from "../shared/news-quality.js";
const timestamp = (value) =>
  new Date(value).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  }) + " IST";
function Headline({ article }) {
  return (
    <>
      {article.url ? (
        <a href={article.url} target="_blank" rel="noreferrer">
          {article.title}
        </a>
      ) : (
        <b>{article.title}</b>
      )}
      <small>
        {article.publisher} · {timestamp(article.publishedAt)}
        {article.via ? ` · via ${article.via}` : ""}
      </small>
    </>
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
    <>
      <Headline article={article} />
      {article.category && (
        <span className="news-event-category">{article.category}</span>
      )}
      {related.length > 0 && (
        <details className="news-related">
          <summary>
            {otherSources
              ? `${otherSources} other source${otherSources === 1 ? "" : "s"} · `
              : ""}
            {related.length} related headline{related.length === 1 ? "" : "s"}
          </summary>
          <ul>
            {related.map((item, i) => (
              <li key={item.url || i}>
                <Headline article={item} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
