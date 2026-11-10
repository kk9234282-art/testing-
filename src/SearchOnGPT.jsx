import React, { useRef, useState } from "react";
import { ArrowUpRight, Sparkles } from "lucide-react";
import { buildCompanyResearchPrompt } from "../shared/company-research.js";

const CHATGPT_URL = "https://chatgpt.com/";

async function copyPrompt(prompt) {
  if (navigator.clipboard?.writeText) {
    try {
      // Start inside the click event, before the browser follows the external link.
      await navigator.clipboard.writeText(prompt);
      return true;
    } catch {
      /* Try the browser's user-initiated copy fallback. */
    }
  }
  const activeElement = document.activeElement;
  const selection = document.getSelection();
  const ranges = selection
    ? Array.from({ length: selection.rangeCount }, (_, i) =>
        selection.getRangeAt(i).cloneRange(),
      )
    : [];
  const input = document.createElement("textarea");
  input.value = prompt;
  input.readOnly = true;
  input.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
  document.body.appendChild(input);
  try {
    input.select();
    return (
      typeof document.execCommand === "function" && document.execCommand("copy")
    );
  } catch {
    return false;
  } finally {
    input.remove();
    activeElement?.focus({ preventScroll: true });
    if (selection) {
      selection.removeAllRanges();
      ranges.forEach((range) => selection.addRange(range));
    }
  }
}

export default function SearchOnGPT({ company }) {
  const prompt = buildCompanyResearchPrompt(company);
  const [status, setStatus] = useState("idle");
  const busy = useRef(false);
  const promptRef = useRef(null);

  async function copy() {
    if (busy.current || !prompt) return;
    busy.current = true;
    setStatus("copying");
    try {
      setStatus((await copyPrompt(prompt)) ? "copied" : "failed");
    } catch {
      setStatus("failed");
    } finally {
      busy.current = false;
    }
  }
  function start(event) {
    if (busy.current) {
      event.preventDefault();
      return;
    }
    // Native target=_blank navigation preserves the user gesture without a popup API.
    void copy();
  }
  return (
    <div className="gpt-research-action">
      {prompt ? (
        <a
          className="secondary-button gpt-research-button"
          href={CHATGPT_URL}
          target="_blank"
          rel="noopener noreferrer"
          onClick={start}
        >
          <Sparkles size={14} aria-hidden="true" />
          Search on GPT <ArrowUpRight size={14} aria-hidden="true" />
        </a>
      ) : (
        <button
          className="secondary-button gpt-research-button"
          type="button"
          disabled
          title="Company name or ticker is needed."
        >
          <Sparkles size={14} aria-hidden="true" />
          Search on GPT <ArrowUpRight size={14} aria-hidden="true" />
        </button>
      )}
      {!prompt && (
        <p className="gpt-research-status">
          Company details are unavailable. A company name or ticker is needed.
        </p>
      )}
      {status === "copying" && (
        <p className="gpt-research-status" role="status">
          Copying the full research prompt…
        </p>
      )}
      {status === "copied" && (
        <p className="gpt-research-status" role="status">
          Research prompt copied. Paste it into ChatGPT (Ctrl+V or ⌘V), review
          it, then send.{" "}
          <a href={CHATGPT_URL} target="_blank" rel="noopener noreferrer">
            Open ChatGPT ↗
          </a>
        </p>
      )}
      {status === "failed" && (
        <div className="gpt-research-fallback">
          <p className="gpt-research-status" role="status">
            Your browser couldn’t copy automatically. Copy the prompt below,
            then paste it into ChatGPT and review before sending.
          </p>
          <textarea
            ref={promptRef}
            value={prompt || ""}
            readOnly
            rows={7}
            aria-label="Company research prompt"
          />
          <div className="gpt-fallback-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                promptRef.current?.focus();
                promptRef.current?.select();
              }}
            >
              Select prompt
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => void copy()}
            >
              Copy again
            </button>
            <a href={CHATGPT_URL} target="_blank" rel="noopener noreferrer">
              Open ChatGPT ↗
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
