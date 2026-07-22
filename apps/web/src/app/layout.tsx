import type { Metadata } from "next";
import type { ReactNode } from "react";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { TrpcProvider } from "@/lib/trpc/client";
import { THEME_BOOT_SCRIPT } from "@/components/theme-toggle";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "Credexis",
  description: "SBA 7(a) underwriting automation — documents in, banker-grade pro-forma out.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Applies the stored theme before first paint (M8.1). */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className={`${GeistSans.variable} ${GeistMono.variable} font-sans antialiased`}>
        <TrpcProvider>
          {children}
          <Toaster richColors position="top-right" />
        </TrpcProvider>
      </body>
    </html>
  );
}
