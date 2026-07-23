"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ── v0.15 voice input — Web Speech API, dictation only (never auto-sends).
export type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult:
    | ((e: {
        resultIndex: number;
        results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>;
      }) => void)
    | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
};

export const SpeechRecognitionCtor =
  typeof window !== "undefined"
    ? ((window as unknown as Record<string, unknown>).SpeechRecognition ??
      (window as unknown as Record<string, unknown>).webkitSpeechRecognition)
    : undefined;

/** Feature detection for the callers that hide the mic entirely. */
export const dictationSupported = () => SpeechRecognitionCtor != null;

/**
 * Push-to-dictate into a text field. Shared by the coach composer and the
 * check-in / debrief sheets so there is one implementation of the browser
 * quirks — chiefly that `continuous: true` means the recogniser never stops
 * on its own and must be stopped on unmount, or it keeps listening after
 * the athlete navigates away.
 *
 * `onText` receives only finalised transcript chunks; interim results are
 * requested so the browser commits sooner, never appended.
 */
export function useDictation(onText: (chunk: string) => void): {
  dictating: boolean;
  supported: boolean;
  toggle: () => void;
} {
  const [dictating, setDictating] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  // The recogniser's callbacks outlive any single render, so they read the
  // latest onText through a ref rather than closing over a stale one.
  const onTextRef = useRef(onText);
  useEffect(() => {
    onTextRef.current = onText;
  }, [onText]);

  const toggle = useCallback(() => {
    if (!SpeechRecognitionCtor) return;
    if (dictating) {
      recognitionRef.current?.stop();
      return; // onend flips state
    }
    const rec = new (
      SpeechRecognitionCtor as new () => SpeechRecognitionLike
    )();
    rec.lang = navigator.language;
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let finalText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
      }
      if (finalText) onTextRef.current(finalText.trim());
    };
    rec.onend = () => setDictating(false);
    rec.onerror = () => setDictating(false);
    recognitionRef.current = rec;
    rec.start();
    setDictating(true);
  }, [dictating]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  return { dictating, supported: SpeechRecognitionCtor != null, toggle };
}
