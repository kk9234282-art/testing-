import { useEffect, useRef, useState } from "react";
import { readNewsHistory, saveNewsHistory } from "../shared/news-history.js";
import { sampleResearch } from "../shared/sample-research.js";
function archive(symbol) {
  try {
    return readNewsHistory(localStorage, symbol);
  } catch {
    return [];
  }
}
export default function useCompanyNews(company, mode, retry, enabled) {
  const key = `${mode}:${company.id}:${retry}`;
  const [snapshot, setSnapshot] = useState(null),
    cache = useRef(null);
  useEffect(() => {
    if (!enabled) return;
    if (mode === "sample") {
      setSnapshot({ key, data: sampleResearch(company, "news"), saved: false });
      return;
    }
    if (
      cache.current?.key === key &&
      Date.now() - cache.current.time < 900000
    ) {
      setSnapshot(cache.current.state);
      return;
    }
    const controller = new AbortController(),
      saved = archive(company.id);
    setSnapshot({
      key,
      loading: true,
      data: {
        articles: saved,
        source: "Saved headlines in this browser",
        fetchedAt: null,
      },
    });
    (async () => {
      try {
        const response = await fetch(
          `/api/company/${encodeURIComponent(company.id)}?${new URLSearchParams({ section: "news", name: company.name })}`,
          { signal: controller.signal },
        );
        const data = await response.json();
        if (controller.signal.aborted) return;
        if (
          !response.ok ||
          data.symbol !== company.id ||
          data.section !== "news" ||
          !Array.isArray(data.articles)
        ) {
          setSnapshot({
            key,
            error: true,
            data: {
              articles: saved,
              sources: data.sources || [],
              source: "Saved headlines in this browser",
              fetchedAt: null,
            },
            saved: saved.length > 0,
          });
          return;
        }
        let history;
        try {
          history = saveNewsHistory(localStorage, company.id, data.articles);
        } catch {
          history = { articles: data.articles, saved: false };
        }
        const state = {
          key,
          data: { ...data, articles: history.articles },
          saved: history.saved,
        };
        cache.current = { key, time: Date.now(), state };
        setSnapshot(state);
      } catch {
        if (!controller.signal.aborted)
          setSnapshot({
            key,
            error: true,
            data: {
              articles: saved,
              source: "Saved headlines in this browser",
              fetchedAt: null,
            },
            saved: saved.length > 0,
          });
      }
    })();
    return () => controller.abort();
  }, [key, company, mode, enabled]);
  return snapshot?.key === key
    ? snapshot
    : {
        loading: enabled,
        data: { articles: mode === "market" ? archive(company.id) : [] },
      };
}
