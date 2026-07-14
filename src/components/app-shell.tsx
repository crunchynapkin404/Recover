import Link from "next/link";
import { SignOutButton } from "@/components/sign-out-button";

interface Props {
  title: string;
  children: React.ReactNode;
}

export function AppShell({ title, children }: Props) {
  return (
    <div className="min-h-svh bg-background">
      <header className="border-b">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-4">
          <nav className="flex items-center gap-6">
            <Link href="/" className="font-semibold tracking-tight">
              Recover
            </Link>
            <Link
              href="/"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Dashboard
            </Link>
            <Link
              href="/wellness"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Log
            </Link>
            <Link
              href="/coach"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Coach
            </Link>
            <Link
              href="/settings"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Settings
            </Link>
          </nav>
          <SignOutButton />
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl px-4 py-8">
        <h1 className="mb-6 text-xl font-semibold tracking-tight">{title}</h1>
        {children}
      </main>
    </div>
  );
}
