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
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ClerkProvider>
          <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <Link href="/" className="font-semibold tracking-tight">
              AgentTrace
            </Link>
            {/* Cache Components: request data (the session) must be read inside Suspense. */}
            <Suspense>
              <nav className="flex items-center gap-3 sm:gap-4">
                <Link href="/demo" className="text-sm underline-offset-4 hover:underline">
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
