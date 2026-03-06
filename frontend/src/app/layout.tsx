import type { Metadata } from "next";
import { Toaster } from "@/components/ui/sonner";
import AppShell from "@/components/layout/AppShell";
import "./globals.css";

export const metadata: Metadata = {
  title: "GenAI Data Factory",
  description: "AI tuning & evaluation data generation pipeline",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body className="antialiased font-sans">
        <AppShell>{children}</AppShell>
        <Toaster />
      </body>
    </html>
  );
}
