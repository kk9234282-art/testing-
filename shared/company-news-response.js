// Optional progressive news transport. Existing JSON responses remain supported.
export async function readCompanyNewsResponse(response, onProgress) {
  if (!response.headers.get("content-type")?.includes("application/x-ndjson")) {
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error("News unavailable"), { data });
    return data;
  }
  if (!response.ok || !response.body) throw new Error("News unavailable");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = "", complete = null, frames = 0, bytes = 0;
  const consume = (line) => {
    if (!line.trim()) return;
    if (complete || ++frames > 8) throw new Error("Invalid news response sequence");
    const frame = JSON.parse(line);
    if (frame.type === "error")
      throw Object.assign(new Error("News unavailable"), { data: frame.data });
    if (!["progress", "complete"].includes(frame.type) || !frame.data)
      throw new Error("Invalid news response");
    if (frame.type === "complete") complete = frame.data;
    else onProgress(frame.data);
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      bytes += value?.byteLength || 0;
      if (bytes > 2_000_000) throw new Error("News response too large");
      buffer += decoder.decode(value, { stream: !done });
      if (buffer.length > 1_000_000) throw new Error("News response too large");
      let boundary;
      while ((boundary = buffer.indexOf("\n")) !== -1) {
        consume(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 1);
      }
      if (done) break;
    }
    consume(buffer);
    if (!complete) throw new Error("News response interrupted");
    return complete;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
