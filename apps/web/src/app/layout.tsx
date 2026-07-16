import type { Metadata } from "next";
import type { ReactNode } from "react";
import { TrpcProvider } from "@/lib/trpc/client";
import "./globals.css";

export const metadata: Metadata = {
  title: "Credexis",
  description: "SBA 7(a) underwriting automation — documents in, banker-grade pro-forma out.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <TrpcProvider>{children}</TrpcProvider>
      </body>
    </html>
  );
}
