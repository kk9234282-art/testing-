import { useEffect, useMemo, useRef, useState } from "react";
import { readNewsHistory, saveNewsHistory } from "../shared/news-history.js";
import { mergeNewsArticles } from "../shared/news.js";
import { readCompanyNewsResponse } from "../shared/company-news-response.js";
import { sampleResearch } from "../shared/sample-research.js";
// Page-memory cache survives closing/reopening a company; no credentials stored.
const completed = new Map();
function archive(symbol) {
  try { return readNewsHistory(localStorage, symbol); } catch { return []; }
}
export default function useCompanyNews(company, mode, retry, enabled) {
  const key = `${mode}:${company.id}:${retry}`;
  const cacheKey = `${mode}:${company.id}:${company.name}`;
  const [snapshot, setSnapshot] = useState(null);
  const previousRetry = useRef(retry);
  const saved = useMemo(() => mode === "market" && enabled ? archive(company.id) : [],
    [company.id, mode, enabled, retry]);
  useEffect(() => {
    if (!enabled) return;
    if (mode === "sample") {
      setSnapshot({ key, data: sampleResearch(company, "news"), saved: false });
      return;
    }
    const force = previousRetry.current !== retry;
    previousRetry.current = retry;
    const cached = completed.get(cacheKey);
    if (!force && cached && Date.now() - cached.time < 900000) {
      setSnapshot({ ...cached.state, key });
      return;
    }
    const controller = new AbortController();
    let receivedHeadlines = false;
    let latest = { articles: saved, source: "Saved headlines in this browser", fetchedAt: null };
    setSnapshot({ key, loading: true, data: latest, saved: saved.length > 0 });
    const validate = (data) => {
      if (data.symbol !== company.id || data.section !== "news" || !Array.isArray(data.articles))
        throw new Error("Invalid news response");
    };
    (async () => {
      try {
        const response = await fetch(
          `/api/company/${encodeURIComponent(company.id)}?${new URLSearchParams({ section: "news", name: company.name, stream: "1" })}`,
          { signal: controller.signal },
        );
        const data = await readCompanyNewsResponse(response, (data) => {
          if (controller.signal.aborted) return;
          validate(data);
          receivedHeadlines ||= data.articles.length > 0;
          latest = { ...data, articles: mergeNewsArticles(data.articles, saved).slice(0, 200) };
          setSnapshot({ key, loading: true, data: latest, saved: saved.length > 0 });
        });
        if (controller.signal.aborted) return;
        validate(data);
        let history;
        try { history = saveNewsHistory(localStorage, company.id, data.articles); }
        catch { history = { articles: data.articles, saved: false }; }
        const state = { key, data: { ...data, articles: history.articles }, saved: history.saved };
        if (completed.size >= 30) completed.delete(completed.keys().next().value);
        completed.set(cacheKey, { time: Date.now(), state });
        setSnapshot(state);
      } catch (error) {
        if (!controller.signal.aborted) setSnapshot({
          key, error: true,
          data: { ...latest, sources: error.data?.sources || latest.sources || [] },
          saved: saved.length > 0, partial: receivedHeadlines,
        });
      }
    })();
    return () => controller.abort();
  }, [key, cacheKey, company, mode, enabled, retry, saved]);
  return snapshot?.key === key ? snapshot : { loading: enabled, data: { articles: saved } };
}
