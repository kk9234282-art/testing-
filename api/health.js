export default function health(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method && !["GET", "HEAD"].includes(req.method)) {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).json({ error: "Method not allowed" });
  }
  return res.status(200).json({ ok: true });
}
