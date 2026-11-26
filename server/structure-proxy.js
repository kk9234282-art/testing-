// Private research-service bridge; never inject the owner's bearer token.
export default async function structureProxy(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!["GET", "POST"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const source = process.env.SCANNER_SERVICE_URL;
  if (!source)
    return res
      .status(503)
      .json({
        error:
          "Private scanner service is not configured. The separate illustrative scanner remains available.",
      });
  let target;
  try {
    const base = new URL(source);
    if (
      base.username ||
      base.password ||
      base.search ||
      base.hash ||
      !["https:", "http:"].includes(base.protocol) ||
      (base.protocol === "http:" &&
        !["127.0.0.1", "localhost"].includes(base.hostname))
    )
      throw new Error("Invalid service address");
    const incoming = new URL(req.originalUrl || req.url, "http://localhost");
    if (
      !/^\/api\/structure\/(?:health|datasets|import|market-data\/status|runs\/(?:scan|backtest|[a-f0-9-]{36}(?:\/stocks\/[A-Z0-9_-]{1,60})?))$/.test(
        incoming.pathname,
      )
    )
      return res.status(404).json({ error: "Unknown scanner endpoint" });
    target = new URL(incoming.pathname, base.origin);
  } catch {
    return res
      .status(503)
      .json({ error: "Scanner service address is not configured correctly" });
  }
  try {
    let body;
    if (req.method === "POST") {
      body = Buffer.isBuffer(req.body)
        ? req.body
        : Buffer.from(
            typeof req.body === "string"
              ? req.body
              : JSON.stringify(req.body || {}),
          );
      if (body.length > 3_000_000)
        return res
          .status(413)
          .json({ error: "Use the private CLI for imports above 3 MB" });
    }
    const response = await fetch(target, {
      method: req.method,
      body,
      headers: {
        "Content-Type": "application/json",
        ...(req.headers?.authorization
          ? { Authorization: req.headers.authorization }
          : {}),
      },
      signal: AbortSignal.timeout(55000),
      redirect: "error",
    });
    const data = await response.json();
    return res.status(response.status).json(data);
  } catch {
    return res
      .status(502)
      .json({
        error:
          "Private scanner service is unreachable. No sample results have been substituted.",
      });
  }
}
