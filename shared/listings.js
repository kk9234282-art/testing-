const clean = (value) => (typeof value === "string" ? value.trim() : "");
const isinOf = (stock) =>
  /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(clean(stock.isin).toUpperCase())
    ? clean(stock.isin).toUpperCase()
    : "";
const nameOf = (stock) =>
  clean(stock.name)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\bltd\.?$/, "limited")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
export const exchangeLabel = (stock) =>
  stock?.exchangeLabel || stock?.exchange || "";
export const listingIds = (stock) =>
  stock?.listingIds || [stock?.id].filter(Boolean);
export function matchesListing(stock, key) {
  return (
    listingIds(stock).includes(key) ||
    (stock.symbols || [stock.symbol]).includes(key)
  );
}
export function sameCompany(a, b) {
  return listingIds(a).some((id) => listingIds(b).includes(id));
}

// Prefer NSE for the combined view. Never average prices or sum issuer market caps.
export function companyListings(input, exchange = "") {
  const raw = new Map();
  for (const stock of input)
    for (const listing of stock.listings || [stock])
      raw.set(listing.id, listing);
  const rows = [...raw.values()],
    parent = rows.map((_, i) => i),
    members = rows.map((s, i) => [i]);
  const root = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const groupBy = (key) => {
    const groups = new Map();
    rows.forEach((s, i) => {
      const value = key(s);
      if (value) {
        if (!groups.has(value)) groups.set(value, []);
        groups.get(value).push(i);
      }
    });
    return groups.values();
  };
  function join(indices) {
    if (indices.length !== 2) return;
    const first = root(indices[0]),
      second = root(indices[1]);
    if (first === second) return;
    const combined = [...members[first], ...members[second]];
    if (combined.length !== 2) return;
    const [a, b] = combined.map((i) => rows[i]);
    if (
      a.exchange === b.exchange ||
      !["NSE", "BSE"].includes(a.exchange) ||
      !["NSE", "BSE"].includes(b.exchange)
    )
      return;
    const ia = isinOf(a),
      ib = isinOf(b);
    if (ia && ib && ia !== ib) return;
    parent[second] = first;
    members[first] = combined;
  }
  for (const indices of groupBy(isinOf)) join(indices);
  for (const indices of groupBy(nameOf)) join(indices);
  const groups = new Map();
  rows.forEach((s, i) => {
    const key = root(i);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  });
  return [...groups.values()].flatMap((listings) => {
    listings.sort(
      (a, b) =>
        (a.exchange === "NSE" ? 0 : 1) - (b.exchange === "NSE" ? 0 : 1) ||
        a.id.localeCompare(b.id),
    );
    const preferred =
      exchange && exchange !== "all"
        ? listings.find((s) => s.exchange === exchange)
        : listings[0];
    if (!preferred) return [];
    const exchanges = [...new Set(listings.map((s) => s.exchange))];
    return [
      {
        ...preferred,
        listingIds: listings.map((s) => s.id),
        symbols: [...new Set(listings.map((s) => s.symbol))],
        exchanges,
        exchangeLabel: exchanges.join(" + "),
        listings,
      },
    ];
  });
}
