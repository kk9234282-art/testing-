import React, { useRef, useState } from "react";
import type { Dataset, Scan } from "./types";

type Review = {
  listing_id: string;
  kind: string;
  effective_on: string;
  published_at: string;
  source_url: string;
  document_sha256: string;
  reviewer: string;
  disposition: string;
  notes: string;
};
const empty: Review = {
  listing_id: "",
  kind: "dividend",
  effective_on: "",
  published_at: "",
  source_url: "",
  document_sha256: "",
  reviewer: "",
  disposition: "Needs evidence",
  notes: "",
};
const kinds = ["dividend", "split", "bonus", "other"];
const dispositions = [
  "Needs evidence",
  "Under review",
  "Discrepancy",
  "Review recorded",
];
const limits: Record<keyof Review, number> = {
  listing_id: 100,
  kind: 20,
  effective_on: 10,
  published_at: 40,
  source_url: 1000,
  document_sha256: 64,
  reviewer: 100,
  disposition: 30,
  notes: 3000,
};
function check(value: unknown): Review {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Each review must be an object.");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !Object.hasOwn(empty, key)))
    throw Error("Unknown review fields are not accepted.");
  const result = { ...empty };
  for (const key of Object.keys(empty) as (keyof Review)[]) {
    const text = input[key];
    if (typeof text !== "string" || text.length > limits[key])
      throw Error(`Invalid or oversized ${key}.`);
    result[key] = text.trim();
  }
  if (!result.listing_id) throw Error("Enter a listing ID.");
  if (
    !kinds.includes(result.kind) ||
    !dispositions.includes(result.disposition)
  )
    throw Error("Unknown action type or review state.");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(result.effective_on) ||
    !Number.isFinite(Date.parse(result.effective_on)) ||
    new Date(result.effective_on).toISOString().slice(0, 10) !==
      result.effective_on
  )
    throw Error("Enter a valid effective date.");
  if (
    result.published_at &&
    (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      result.published_at,
    ) ||
      !Number.isFinite(Date.parse(result.published_at)) ||
      new Date(result.published_at.slice(0, 10)).toISOString().slice(0, 10) !==
        result.published_at.slice(0, 10))
  )
    throw Error(
      "Publication time must include seconds and timezone, for example 2026-08-01T17:20:00+05:30.",
    );
  if (result.source_url) {
    let url: URL;
    try {
      url = new URL(result.source_url);
    } catch {
      throw Error("Enter an HTTPS source URL.");
    }
    if (url.protocol !== "https:" || url.username || url.password)
      throw Error("Source URL must use HTTPS without credentials.");
  }
  if (
    result.document_sha256 &&
    !/^[a-fA-F0-9]{64}$/.test(result.document_sha256)
  )
    throw Error("Document SHA-256 must be 64 hexadecimal characters.");
  if (
    result.disposition === "Review recorded" &&
    (!result.published_at ||
      !result.source_url ||
      !result.document_sha256 ||
      !result.reviewer ||
      !result.notes)
  )
    throw Error(
      "A recorded review requires publication time, source URL, document hash, reviewer and evidence notes. This does not approve an action.",
    );
  return result;
}

export default function DataReview({
  scan,
  dataset,
  sample,
  scope,
}: {
  scan: Scan | null;
  dataset?: Dataset;
  sample: boolean;
  scope: string;
}) {
  const [records, setRecords] = useState<Review[]>([]);
  const [draft, setDraft] = useState<Review>({ ...empty });
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [hashing, setHashing] = useState(false);
  const importing = useRef(false);
  const [importBusy, setImportBusy] = useState(false);
  const [qualitySearch, setQualitySearch] = useState("");
  const qualityRows = (scan?.rows || []).filter((row) =>
    `${row.symbol} ${row.name} ${row.listing_id} ${row.data_quality}`
      .toLowerCase()
      .includes(qualitySearch.toLowerCase()),
  );
  const manifest = scan?.manifest || dataset?.manifest;
  const checks = [
    [
      "Corporate-action history",
      manifest?.corporate_actions_complete === true,
      "Verify action factors and original publication timing across the full declared scope.",
    ],
    [
      "Historical equity universe",
      manifest?.universe_history_complete === true,
      "Reconcile past listings, delistings, aliases and non-equity exclusions.",
    ],
    [
      "Stock history coverage",
      !!scan &&
        scan.coverage.active_equities > 0 &&
        scan.coverage.complete === scan.coverage.active_equities,
      scan
        ? `${scan.coverage.complete} of ${scan.coverage.active_equities} active equities reported complete by this scan. This does not certify exchange accuracy.`
        : "Run a scan to inspect session coverage.",
    ],
    [
      "Requested benchmark roles",
      !!scan &&
        scan.regime.missing_indices.length === 0 &&
        scan.regime.indices.length > 0,
      scan?.regime.missing_indices.length
        ? `Missing: ${scan.regime.missing_indices.join(", ")}.`
        : "Index history, point-in-time membership and breadth coverage require separate review.",
    ],
  ] as const;
  function update(key: keyof Review, value: string) {
    setDraft((current) => ({ ...current, [key]: value }));
  }
  async function importReviews(file?: File) {
    if (!file || importing.current) return;
    importing.current = true;
    setImportBusy(true);
    setError("");
    setMessage("");
    try {
      if (file.size > 3_000_000) throw Error("Review import limit is 3 MB.");
      const value = JSON.parse(await file.text());
      if (
        !value ||
        typeof value !== "object" ||
        value.format !== "structure-action-review-v1" ||
        value.scope !== scope ||
        !Array.isArray(value.records) ||
        value.records.length > 100
      )
        throw Error(
          "Use a review export for this exact dataset scope (maximum 100 records).",
        );
      const incoming = value.records.map(check) as Review[];
      if (incoming.length + records.length > 100)
        throw Error("Maximum 100 review drafts per scope.");
      setRecords((current) => [...current, ...incoming]);
      setMessage(
        `Imported ${incoming.length} review drafts. No approvals changed.`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      importing.current = false;
      setImportBusy(false);
    }
  }
  async function hashDocument(file?: File) {
    if (!file) return;
    setError("");
    setMessage("");
    if (file.size > 20_000_000) {
      setError("Local document hashing limit is 20 MB.");
      return;
    }
    setHashing(true);
    try {
      const digest = await crypto.subtle.digest(
        "SHA-256",
        await file.arrayBuffer(),
      );
      update(
        "document_sha256",
        Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join(""),
      );
      setMessage(
        "Document hashed locally. Its contents were not uploaded; a hash does not verify the notice.",
      );
    } catch {
      setError(
        "Document hashing is unavailable. Use HTTPS or enter a locally calculated SHA-256.",
      );
    } finally {
      setHashing(false);
    }
  }
  function exportReviews() {
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            {
              format: "structure-action-review-v1",
              scope,
              approval_effect: "none",
              records,
            },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "structure-action-reviews.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section
      className="sl-panel sl-data-review"
      aria-label="Data quality and action review"
    >
      <h2>Data quality & action review</h2>
      <p className="sl-import-status">
        {sample
          ? "Synthetic demonstration — these checks do not certify real market data."
          : "Private research inputs — completeness flags are importer attestations, not independent certification."}{" "}
        Review drafts never change scanner approvals, signals or backtest
        eligibility.
      </p>
      <p className="sl-note">
        Source: {manifest?.source || "No dataset loaded"} · Scope: {scope}
      </p>
      <div className="sl-review-checks">
        {checks.map(([label, passed, note]) => (
          <article key={label}>
            <h3>{label}</h3>
            <b className={passed ? "sl-review-reported" : "sl-review-missing"}>
              {passed
                ? sample
                  ? "Reported in sample"
                  : "Reported by input"
                : "Missing / needs review"}
            </b>
            <p>{note}</p>
          </article>
        ))}
      </div>
      {scan?.quality_warning && (
        <p className="sl-import-status">{scan.quality_warning}</p>
      )}
      {scan && (
        <details>
          <summary>
            Stock-level data checks ({scan.rows.length} equities)
          </summary>
          <p className="sl-note">
            Scan session: {scan.as_of}. A complete row does not establish
            complete historical universe or action evidence.
          </p>
          <label className="sl-review-notes">
            Search stock data checks
            <input
              value={qualitySearch}
              onChange={(e) => setQualitySearch(e.target.value)}
              placeholder="Symbol, company or quality issue"
            />
          </label>
          <p className="sl-note">
            Showing {Math.min(qualityRows.length, 100)} of {qualityRows.length}{" "}
            matching rows. Refine search to inspect other stocks.
          </p>
          <div className="sl-table-scroll">
            <table aria-label="Stock data quality">
              <thead>
                <tr>
                  <th>Stock</th>
                  <th>Listing</th>
                  <th>Sessions</th>
                  <th>Data quality</th>
                  <th>Structure status</th>
                </tr>
              </thead>
              <tbody>
                {qualityRows.slice(0, 100).map((row) => (
                  <tr key={row.security_id}>
                    <td>{row.symbol}</td>
                    <td>{row.listing_id}</td>
                    <td>{row.history_sessions}</td>
                    <td>{row.data_quality}</td>
                    <td>{row.status || "Unavailable / no classification"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      <h3>Corporate-action evidence drafts</h3>
      <p>
        Keep original notices privately. Record publication time with its
        timezone; ex-date, record date and download time cannot replace it.
        Resolve stale ISINs, amendments and unsupported actions before declaring
        completeness.
      </p>
      <p className="sl-note">
        Drafts stay in this browser tab’s memory. Export before reloading or
        changing source/dataset. Neither drafts nor documents are sent to the
        server or stored in browser storage. Exported files can contain private
        research notes.
      </p>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (importing.current) return;
          setError("");
          setMessage("");
          try {
            const item = check(draft);
            if (records.length >= 100)
              throw Error("Maximum 100 review drafts per scope.");
            setRecords((current) => [...current, item]);
            setDraft({ ...empty });
            setMessage("Review draft saved in memory. No approvals changed.");
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        <div className="sl-filters">
          <label>
            Listing ID
            <input
              required
              maxLength={100}
              value={draft.listing_id}
              placeholder="NSE:PNB"
              onChange={(e) => update("listing_id", e.target.value)}
            />
          </label>
          <label>
            Action type
            <select
              aria-label="Action type"
              value={draft.kind}
              onChange={(e) => update("kind", e.target.value)}
            >
              {kinds.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </label>
          <label>
            Effective date
            <input
              required
              type="date"
              value={draft.effective_on}
              onChange={(e) => update("effective_on", e.target.value)}
            />
          </label>
          <label>
            Original publication time
            <input
              maxLength={40}
              value={draft.published_at}
              placeholder="2026-08-01T17:20:00+05:30"
              onChange={(e) => update("published_at", e.target.value)}
            />
          </label>
          <label>
            Notice source URL
            <input
              maxLength={1000}
              type="url"
              value={draft.source_url}
              placeholder="https://…"
              onChange={(e) => update("source_url", e.target.value)}
            />
          </label>
          <label>
            Document SHA-256
            <input
              maxLength={64}
              value={draft.document_sha256}
              onChange={(e) => update("document_sha256", e.target.value)}
            />
          </label>
          <label>
            Reviewer
            <input
              maxLength={100}
              value={draft.reviewer}
              onChange={(e) => update("reviewer", e.target.value)}
            />
          </label>
          <label>
            Review state
            <select
              aria-label="Review state"
              value={draft.disposition}
              onChange={(e) => update("disposition", e.target.value)}
            >
              {dispositions.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="sl-review-notes">
          Evidence notes
          <textarea
            maxLength={3000}
            rows={4}
            value={draft.notes}
            placeholder="Original timestamp location, ISIN, ratios or cash amount, amendments, factor convention and discrepancies…"
            onChange={(e) => update("notes", e.target.value)}
          />
        </label>
        <div className="sl-import-actions">
          <button type="submit" disabled={hashing || importBusy}>
            Save review draft
          </button>
          <label className="sl-button">
            Hash local notice
            <input
              type="file"
              aria-label="Hash local notice"
              disabled={hashing || importBusy}
              onChange={(e) => {
                void hashDocument(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
        </div>
      </form>
      <div className="sl-import-actions">
        <button onClick={exportReviews} disabled={!records.length}>
          Export review drafts
        </button>
        <label className="sl-button">
          Import review drafts
          <input
            type="file"
            accept=".json,application/json"
            aria-label="Import action reviews"
            disabled={importBusy || hashing}
            onChange={(e) => {
              void importReviews(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      <p className="sl-note">
        {records.length} / 100 drafts · “Review recorded” documents a review
        only. Promotion requires a separately verified, versioned historical
        import. No approval button is provided here.
      </p>
      {!!records.length && (
        <div className="sl-table-scroll">
          <table aria-label="Corporate-action review drafts">
            <thead>
              <tr>
                {[
                  "Listing",
                  "Action",
                  "Effective",
                  "Published",
                  "Review state",
                  "Evidence",
                  "Manage",
                ].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {records.map((record, i) => (
                <tr key={i}>
                  <td>{record.listing_id}</td>
                  <td>{record.kind}</td>
                  <td>{record.effective_on}</td>
                  <td>{record.published_at || "Missing"}</td>
                  <td>{record.disposition}</td>
                  <td>
                    <details>
                      <summary>View evidence</summary>
                      <p>Source: {record.source_url || "Missing"}</p>
                      <p>SHA-256: {record.document_sha256 || "Missing"}</p>
                      <p>Reviewer: {record.reviewer || "Missing"}</p>
                      <p>{record.notes || "No notes"}</p>
                    </details>
                  </td>
                  <td>
                    <button
                      aria-label={`Edit review ${i + 1}`}
                      disabled={importBusy || hashing}
                      onClick={() => {
                        if (
                          (Object.keys(empty) as (keyof Review)[]).some(
                            (key) => draft[key] !== empty[key],
                          )
                        ) {
                          setError(
                            "Save the current form before editing another review.",
                          );
                          return;
                        }
                        setDraft({ ...record });
                        setRecords((current) =>
                          current.filter((_, n) => n !== i),
                        );
                        setMessage(
                          "Review moved to the form. Save it again to include it in exports.",
                        );
                      }}
                    >
                      Edit
                    </button>
                    <button
                      aria-label={`Remove review ${i + 1}`}
                      disabled={importBusy || hashing}
                      onClick={() =>
                        setRecords((current) =>
                          current.filter((_, n) => n !== i),
                        )
                      }
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
