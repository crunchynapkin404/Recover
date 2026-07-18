/**
 * Biomarker extraction service (v0.13). Turns pasted lab text or an
 * uploaded PDF/image into candidate biomarkers using the user's own LLM,
 * falling back to the deterministic text parser when no LLM is configured.
 * Nothing is stored here — the caller reviews the result first.
 */
import { generateText } from "ai";
import { resolveProvider } from "@/lib/llm-provider";
import {
  EXTRACTION_PROMPT,
  parseLabText,
  validateExtraction,
  type ExtractedBiomarker,
} from "@/lib/health-records";
import { logger } from "@/lib/logger";

export interface ExtractionInput {
  text?: string;
  file?: { data: Uint8Array; mediaType: string };
}

export interface ExtractionResult {
  biomarkers: ExtractedBiomarker[];
  /** How the result was produced, for an honest UI note. */
  method: "llm" | "text-parser";
}

/** Pull the first JSON object/array out of a model response. */
function extractJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : raw;
  const start = body.search(/[[{]/);
  if (start === -1) return null;
  // Walk to the matching close for a best-effort slice.
  const open = body[start];
  const close = open === "[" ? "]" : "}";
  const end = body.lastIndexOf(close);
  if (end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

export async function extractBiomarkers(
  userId: string,
  input: ExtractionInput
): Promise<ExtractionResult> {
  const provider = await resolveProvider(userId, "deep");

  // No LLM configured: text paste still works deterministically.
  if (!provider) {
    if (!input.text?.trim()) {
      throw new Error(
        "No LLM configured. Paste the lab text to extract without a model, or set up the AI coach in Settings."
      );
    }
    return { biomarkers: parseLabText(input.text), method: "text-parser" };
  }

  const content: Array<
    | { type: "text"; text: string }
    | { type: "file"; data: Uint8Array; mediaType: string }
  > = [{ type: "text", text: EXTRACTION_PROMPT }];
  if (input.text?.trim()) {
    content.push({ type: "text", text: `\n\nLab text:\n${input.text}` });
  }
  if (input.file) {
    content.push({
      type: "file",
      data: input.file.data,
      mediaType: input.file.mediaType,
    });
  }

  try {
    const { text } = await generateText({
      model: provider.provider(provider.model),
      messages: [{ role: "user", content }],
    });
    const parsed = extractJson(text);
    const biomarkers = validateExtraction(parsed);
    return { biomarkers, method: "llm" };
  } catch (err) {
    logger.error("biomarker extraction failed", {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    // Fall back to the deterministic parser if we at least have text.
    if (input.text?.trim()) {
      return { biomarkers: parseLabText(input.text), method: "text-parser" };
    }
    throw new Error("Extraction failed. Try pasting the lab text instead.");
  }
}
