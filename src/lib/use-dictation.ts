"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useIsHydrated } from "@/lib/use-hydrated";

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
  /*
   * Support is resolved AFTER MOUNT, never during render.
   *
   * `SpeechRecognitionCtor` is a module constant read from `typeof window`,
   * so it is undefined on the server and (in most browsers) defined on the
   * client. Returning it straight from this hook made the server render no
   * mic and the client's FIRST render render one — and React threw
   * "Hydration failed because the server rendered HTML didn't match the
   * client" on /coach, /coach?history=1 and /?sheet=checkin, discarding and
   * regenerating the whole tree. It is the first cause React's own error
   * message lists: a server/client branch on `typeof window`.
   *
   * `useIsHydrated` is false for the server render AND the hydrating one, so
   * the first client render agrees with the server by construction rather
   * than by discipline. (An effect calling setState would also work and is
   * what this reached for first — the repo's react-hooks/set-state-in-effect
   * rule rejects it, correctly.)
   *
   * The cost is that the mic button appears one tick after mount, which is
   * the right trade: the alternative is a control that renders for a moment
   * in browsers that cannot use it.
   *
   * Do not "simplify" this back to reading the constant during render — see
   * use-dictation.test.tsx, which fails if you do.
   */
  const supported = useIsHydrated() && SpeechRecognitionCtor != null;
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

  return { dictating, supported, toggle };
}
