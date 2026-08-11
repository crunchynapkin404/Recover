import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SwRegister } from "@/components/pwa/sw-register";
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
      // Hardcoded pending Task 5's next-themes wiring (v0.99.0 slice 0),
      // which replaces this with the library's class management. Without
      // it, :root now resolves to the LIGHT token set (Task 2) and nothing
      // else applies `.dark`, so the app would silently render light.
      //
      // SIDE EFFECT, ACCEPTED DELIBERATELY: this is the first time `.dark`
      // has ever been applied, so 11 `dark:` utilities that were dead code
      // become live — api-tokens-card's success box, the outline Button's
      // border/background, destructive Button and Badge, and several
      // hover/focus/aria-invalid variants. They were authored for a dark
      // app and had never rendered as intended. Verified in Task 6/7's
      // screenshot and axe pass; see the plan's Global Constraints.
      className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <SwRegister />
        {children}
      </body>
    </html>
  );
}
