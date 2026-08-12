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
  // STATIC WHILE `forcedTheme` IS IN FORCE (I1, whole-branch review
  // 2026-08-11). This was briefly two `prefers-color-scheme`-scoped entries —
  // #f6f6f6 for light, #0a0a0a for dark — which is the right end state but is
  // wrong today: `src/components/theme-provider.tsx` sets `forcedTheme="dark"`
  // until the slice that lifts it, so the app renders #0a0a0a regardless of
  // the OS preference. On a light-preference device the media-scoped version
  // painted the PWA/browser chrome #f6f6f6 above a #0a0a0a app — a light
  // status bar over a black page, which `main` never did (it was a single
  // hardcoded #0a0a0a) and which `public/manifest.webmanifest`'s
  // `theme_color: "#0a0a0a"` also disagrees with. The meta tag wins over the
  // manifest, so the manifest could not save it.
  //
  // THIS BECOMES PER-THEME AGAIN IN THE SLICE THAT LIFTS `forcedTheme`, in
  // the same commit that removes it — at that point the OS preference really
  // does decide what the app renders, and the two media-scoped entries above
  // become correct. Restore them there, and update the manifest's
  // `theme_color` at the same time.
  //
  // HOW TO CHECK THIS MANUALLY — no screenshot can. Browser and PWA chrome is
  // outside the page, so it is absent from `page.screenshot()` and from
  // anything `scripts/verify-surfaces.ts` captures; `chrome-headless-shell`
  // has no chrome to render in the first place. On a real device: set the OS
  // to LIGHT appearance, open the app (installed to the home screen for the
  // PWA case, and in mobile Safari/Chrome for the browser case), and look at
  // the status-bar / address-bar fill. It must match the page background, not
  // contrast with it. Repeat with the OS set to DARK. Both must look
  // identical while `forcedTheme="dark"` is in force — that identity IS the
  // assertion.
  themeColor: "#0a0a0a",
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
