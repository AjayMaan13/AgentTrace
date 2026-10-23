import type { Metadata } from "next";
import {
  ClerkProvider,
  OrganizationSwitcher,
  Show,
  SignInButton,
  SignUpButton,
  UserButton,
} from "@clerk/nextjs";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { Suspense } from "react";
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
  title: "AgentTrace",
  description: "A debugger for multi-agent LLM workflows: fork a step and measure the fix.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // suppressHydrationWarning: browser extensions (Zotero, dark-mode tools) add attributes to <html>
    // before React loads, which logs a harmless hydration warning. It only silences this one element.
    <html
      lang="en"
      suppressHydrationWarning
      className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ClerkProvider>
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-6">
            <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
              <span aria-hidden className="accent-bg inline-block h-3 w-3 rounded-sm" />
              AgentTrace
            </Link>
            {/* Cache Components: request data (the session) must be read inside Suspense. */}
            <Suspense>
              <nav className="flex items-center gap-3 sm:gap-4">
                <Link href="/demo" className="text-sm text-zinc-300 underline-offset-4 hover:text-white hover:underline">
                  Demo
                </Link>
                <Show when="signed-out">
                  <SignInButton />
                  <SignUpButton />
                </Show>
                <Show when="signed-in">
                  <Link href="/runs" className="text-sm underline-offset-4 hover:underline">
                    Runs
                  </Link>
                  {/* Organizations are workspaces, so a personal account is not offered. */}
                  <OrganizationSwitcher hidePersonal afterSelectOrganizationUrl="/runs" />
                  <UserButton />
                </Show>
              </nav>
            </Suspense>
          </header>
          {children}
        </ClerkProvider>
      </body>
    </html>
  );
}
