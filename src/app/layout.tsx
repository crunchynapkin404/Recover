import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SwRegister } from "@/components/pwa/sw-register";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Recover",
  description: "Your training and recovery, in one calm place.",
  manifest: "/manifest.webmanifest",
  icons: { apple: "/icons/apple-touch-icon.png" },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Recover",
  },
};

export const viewport: Viewport = {
  // HISTORY, kept because half of its instruction is still outstanding.
  // Until v0.111.0 these two entries were a single static #0a0a0a, because
  // `theme-provider.tsx` set `forcedTheme="dark"` and media-scoped values
  // would have painted a light status bar over a black page. That block ended
  // with a two-part instruction: restore the per-theme entries in the slice
  // that lifts `forcedTheme`, AND update the manifest's `theme_color` at the
  // same time.
  //
  // ONLY PART ONE WAS DONE. v0.111.0 restored the per-theme entries below;
  // `public/manifest.webmanifest` has been touched exactly once in its life,
  // by the commit that created it, and still reads
  // `"theme_color": "#0a0a0a"`. So an installed PWA on a light-preference
  // device gets dark chrome over a light page — the very mismatch the old
  // block called out, now arriving from the other direction. The meta tag
  // wins where both apply, which is why this is a PWA-install problem rather
  // than a browser one, and why nothing here is visibly wrong in a tab.
  //
  // NOT FIXED HERE, DELIBERATELY: a manifest holds ONE `theme_color` and the
  // app defaults to `system`, so there is no value that is right for both
  // themes — the options are to pick one, or to drop the key and let the meta
  // tag be the only source. That choice changes install-time chrome on real
  // devices and cannot be verified by anything in this repo (see the next
  // paragraph), so it is recorded rather than guessed at. Noted 2026-09-04.
  //
  // HOW TO CHECK THIS MANUALLY — no screenshot can. Browser and PWA chrome is
  // outside the page, so it is absent from `page.screenshot()` and from
  // anything `scripts/verify-surfaces.ts` captures; `chrome-headless-shell`
  // has no chrome to render in the first place. On a real device: set the OS
  // to LIGHT appearance, open the app (installed to the home screen for the
  // PWA case, and in mobile Safari/Chrome for the browser case), and look at
  // the status-bar / address-bar fill. It must match the page background, not
  // contrast with it. Repeat with the OS set to DARK. Since v0.111.0 the two
  // must now DIFFER — each matching its own theme — where before the
  // assertion was that they look identical.
  // Per-theme since v0.111.0, the release that lifted `forcedTheme`. Browser
  // and PWA chrome now follows the athlete's choice rather than being pinned
  // to dark's --surface-base; the values are exactly those two tokens.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f6f6" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider>
          <SwRegister />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
