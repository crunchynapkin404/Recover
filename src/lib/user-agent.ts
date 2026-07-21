/**
 * Minimal, dependency-free User-Agent → human label parser, used only to
 * show a readable "device" name on the session-management settings card.
 * Not exhaustive — good-enough labels for the common desktop/mobile
 * browsers, falling back to a generic label rather than guessing.
 */
export function describeUserAgent(ua: string | null | undefined): string {
  if (!ua) return "Unknown device";

  const os = (() => {
    if (/iphone/i.test(ua)) return "iPhone";
    if (/ipad/i.test(ua)) return "iPad";
    if (/android/i.test(ua)) return "Android";
    if (/mac os x/i.test(ua)) return "macOS";
    if (/windows/i.test(ua)) return "Windows";
    if (/linux/i.test(ua)) return "Linux";
    return null;
  })();

  const browser = (() => {
    if (/edg\//i.test(ua)) return "Edge";
    if (/opr\//i.test(ua) || /\bopera\b/i.test(ua)) return "Opera";
    if (/crios\//i.test(ua)) return "Chrome";
    if (/fxios\//i.test(ua) || /firefox\//i.test(ua)) return "Firefox";
    if (/chrome\//i.test(ua) && !/chromium/i.test(ua)) return "Chrome";
    if (/safari\//i.test(ua) && /version\//i.test(ua)) return "Safari";
    return null;
  })();

  if (browser && os) return `${browser} on ${os}`;
  if (browser) return browser;
  if (os) return os;
  return "Unknown device";
}
