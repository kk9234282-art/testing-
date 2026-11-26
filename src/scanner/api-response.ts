/** Read JSON safely without displaying platform HTML/text error bodies. */
export async function readResearchResponse(response: Response) {
  let data;
  try {
    data = JSON.parse(await response.text());
  } catch {
    const hint =
      response.status === 404
        ? "The website route was not found. Refresh after the website deployment finishes."
        : "Check the website deployment and backend connection.";
    throw new Error(
      `Scanner service returned a non-JSON response (HTTP ${response.status}). ${hint}`,
    );
  }
  if (data === null || typeof data !== "object") {
    throw new Error(
      `Scanner service returned an unexpected response format (HTTP ${response.status}).`,
    );
  }
  if (!response.ok) {
    const detail =
      typeof data.detail === "string"
        ? data.detail
        : Array.isArray(data.detail)
          ? data.detail
              .map(
                (item: { loc?: unknown[]; msg?: string }) =>
                  `${Array.isArray(item.loc) ? item.loc.join(".") : "Request"}: ${item.msg || "Invalid value"}`,
              )
              .join("; ")
          : typeof data.error === "string"
            ? data.error
            : `Research request failed (HTTP ${response.status})`;
    throw new Error(detail);
  }
  return data;
}
