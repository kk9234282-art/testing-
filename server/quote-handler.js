import { listings, parseChart } from './market.js';

// Each warm function instance keeps a small cache; the CDN also caches successes.
export function createQuoteHandler({ fetchQuote = globalThis.fetch, now = Date.now } = {}) {
  const cache = new Map();
  return async function quoteHandler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'Method not allowed' });
    }
    const symbol = req.query?.symbol ?? req.params?.symbol;
    if (typeof symbol !== 'string' || !listings.some(stock => stock.symbol === symbol)) {
      return res.status(400).json({ error: 'Unsupported symbol' });
    }
    const cached = cache.get(symbol);
    if (cached && now() - cached.fetched < 60000) {
      res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60');
      return res.json(cached.data);
    }
    try {
      const response = await fetchQuote(
        `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}.NS?interval=1d&range=1mo`,
        { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'Mozilla/5.0' } }
      );
      if (!response.ok) throw new Error(`Provider HTTP ${response.status}`);
      const quote = parseChart(symbol, await response.json());
      const data = { ...quote, source: 'Yahoo Finance (unofficial)', fetchedAt: new Date(now()).toISOString() };
      cache.set(symbol, { fetched: now(), data });
      res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60');
      return res.json(data);
    } catch {
      return res.status(502).json({ error: 'Free market data is unavailable. Try again later or switch to sample data.' });
    }
  };
}

export default createQuoteHandler();
