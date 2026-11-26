import React, { useRef, useState } from "react";
import type { StockRow } from "./types";
import {
  PREFERENCE_KEY,
  PREFERENCE_FORMAT,
  emptyLibrary,
  parseLibrary,
  validatePreferences,
  validateFilters,
  importBackup,
} from "./preferences";
import type { Scope, Library, Preferences, Filters } from "./preferences";

export function useResearchPreferences(scope: Scope) {
  const [initial] = useState(() => {
    try {
      const raw = localStorage.getItem(PREFERENCE_KEY);
      return { library: raw ? parseLibrary(raw) : emptyLibrary(), warning: "" };
    } catch {
      return {
        library: emptyLibrary(),
        warning:
          "Saved research preferences are unavailable or invalid. Changes will stay in memory if browser storage is blocked. Export a backup before leaving.",
      };
    }
  });
  const [library, setLibrary] = useState<Library>(initial.library);
  const latest = useRef(library);
  const [warning, setWarning] = useState(initial.warning);
  const [message, setMessage] = useState("");
  function save(next: Preferences) {
    const validated = validatePreferences(next);
    const updated = { ...latest.current, [scope]: validated };
    latest.current = updated;
    setLibrary(updated);
    try {
      const raw = JSON.stringify({ format: PREFERENCE_FORMAT, ...updated });
      if (raw.length > 1_000_000) throw Error("Storage size limit");
      localStorage.setItem(PREFERENCE_KEY, raw);
      setWarning("");
    } catch {
      setWarning(
        "Browser storage is unavailable or full. Changes are in memory only; export a backup before leaving.",
      );
    }
    return validated;
  }
  function toggle(row: StockRow) {
    setMessage("");
    try {
      const current = latest.current[scope];
      const watched = current.watchlist.some(
        (w) => w.security_id === row.security_id,
      );
      save({
        ...current,
        watchlist: watched
          ? current.watchlist.filter((w) => w.security_id !== row.security_id)
          : [
              ...current.watchlist,
              {
                security_id: row.security_id,
                symbol: row.symbol,
                name: row.name,
                isin: row.isin,
              },
            ],
      });
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  return {
    preferences: library[scope],
    current: () => latest.current[scope],
    save,
    toggle,
    warning,
    message,
    setMessage,
  };
}

type Tools = ReturnType<typeof useResearchPreferences>;
export default function ResearchTools({
  scope,
  tools,
  filters,
  apply,
  rows,
  openStock,
}: {
  scope: Scope;
  tools: Tools;
  filters: Filters;
  apply: (filters: Filters) => void;
  rows: StockRow[];
  openStock: (row: StockRow) => void;
}) {
  const [name, setName] = useState("");
  const [selected, setSelected] = useState("");
  const [importing, setImporting] = useState(false);
  const { preferences, save, setMessage } = tools;
  function attempt(action: () => void) {
    setMessage("");
    try {
      action();
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  function exportBackup() {
    const blob = new Blob(
      [
        JSON.stringify(
          { format: PREFERENCE_FORMAT, scope, preferences },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob),
      link = document.createElement("a");
    link.href = url;
    link.download = `structure-${scope}-preferences.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function upload(file?: File) {
    if (!file || importing) return;
    setImporting(true);
    setMessage("");
    try {
      if (file.size > 1_000_000) throw Error("Backup import limit is 1 MB.");
      const next = importBackup(await file.text(), scope, tools.current());
      save(next);
      setMessage(
        "Backup merged. Existing stocks were deduplicated; no research signals changed.",
      );
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setImporting(false);
    }
  }
  return (
    <section
      className="sl-panel sl-research-tools"
      aria-label="Scanner research workspace"
    >
      <h2>Watchlist & saved filters</h2>
      <p>
        {scope === "sample"
          ? "Sample workspace — synthetic stocks only."
          : "Private workspace — saved stock identities, not market-data history."}{" "}
        Preferences are saved in this browser with no account or API calls. They
        are separate from the main dashboard watchlist.
      </p>
      <p className="sl-note">
        Back up before clearing browser data. Other people using this browser
        profile can see these preferences. Keep one editing tab open to avoid
        overwriting changes.
      </p>
      {tools.warning && <p role="alert">{tools.warning}</p>}
      {tools.message && <p role="status">{tools.message}</p>}
      <h3>Saved filters</h3>
      <p className="sl-note">
        Presets include stage, sector, exchange, search, RS, volume, ADX, sort,
        visible columns and watchlist-only mode. They do not include
        credentials, evidence, dates or engine parameters. Saving uses the
        current Discovery filters; applying opens Discovery.
      </p>
      <form
        className="sl-import-actions"
        onSubmit={(e) => {
          e.preventDefault();
          attempt(() => {
            const trimmed = name.trim();
            if (
              preferences.presets.some(
                (p) => p.name.toLowerCase() === trimmed.toLowerCase(),
              )
            )
              throw Error(
                "That preset name already exists. Use another name or remove the old preset.",
              );
            save({
              ...preferences,
              presets: [
                ...preferences.presets,
                { name: trimmed, filters: validateFilters(filters) },
              ],
            });
            setName("");
            setMessage("Current Discovery filters saved.");
          });
        }}
      >
        <label>
          Preset name
          <input
            required
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button type="submit" disabled={importing}>
          Save current filters
        </button>
      </form>
      <div className="sl-import-actions">
        <select
          aria-label="Saved scanner filters"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">Choose a preset</option>
          {preferences.presets.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
        </select>
        <button
          disabled={
            !preferences.presets.some((p) => p.name === selected) || importing
          }
          onClick={() =>
            attempt(() => {
              const preset = preferences.presets.find(
                (p) => p.name === selected,
              );
              if (preset) apply(validateFilters(preset.filters));
            })
          }
        >
          Apply saved filters
        </button>
        <button
          disabled={!selected || importing}
          onClick={() =>
            attempt(() => {
              save({
                ...preferences,
                presets: preferences.presets.filter((p) => p.name !== selected),
              });
              setSelected("");
              setMessage("Preset removed.");
            })
          }
        >
          Remove saved filters
        </button>
      </div>
      <h3>Watched stocks ({preferences.watchlist.length} / 500)</h3>
      <p className="sl-note">
        Stocks use the imported stable security ID, so NSE/BSE aliases share one
        entry when the dataset identifies them as one company. Availability and
        prices come only from the current scan; missing stocks are retained
        without invented values. Identity changes still require reviewed source
        metadata.
      </p>
      {!preferences.watchlist.length ? (
        <p className="sl-empty">
          Use “Watch” beside a stock in Discovery to start your research list.
        </p>
      ) : (
        <div className="sl-table-scroll">
          <table aria-label="Scanner watchlist">
            <thead>
              <tr>
                <th>Stock</th>
                <th>Current scan</th>
                <th>Manage</th>
              </tr>
            </thead>
            <tbody>
              {preferences.watchlist.map((item) => {
                const current = rows.find(
                  (row) => row.security_id === item.security_id,
                );
                return (
                  <tr key={item.security_id}>
                    <td>
                      {current?.symbol || item.symbol}
                      <small>
                        {current?.name || item.name} ·{" "}
                        {current?.isin || item.isin}
                      </small>
                    </td>
                    <td>
                      {current
                        ? current.status || "No available classification"
                        : "Not in current scan"}
                    </td>
                    <td>
                      <button
                        disabled={!current}
                        onClick={() => current && openStock(current)}
                      >
                        Open {current?.symbol || item.symbol}
                      </button>
                      <button
                        disabled={importing}
                        aria-label={`Remove ${item.symbol} from scanner watchlist`}
                        onClick={() =>
                          attempt(() => {
                            save({
                              ...preferences,
                              watchlist: preferences.watchlist.filter(
                                (w) => w.security_id !== item.security_id,
                              ),
                            });
                          })
                        }
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="sl-import-actions">
        <button onClick={exportBackup} disabled={importing}>
          Export research backup
        </button>
        <label className="sl-button">
          Import research backup
          <input
            aria-label="Import scanner preferences"
            type="file"
            accept=".json,application/json"
            disabled={importing}
            onChange={(e) => {
              void upload(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      <p className="sl-note">
        Limit: 20 presets per source. Import merges stocks by stable ID and
        rejects conflicting preset names and cross-source backups. No market
        history, tokens or action-review drafts are included.
      </p>
    </section>
  );
}
