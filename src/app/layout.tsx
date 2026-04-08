import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Xpulse AI — Autonomous Crypto Agent on X Layer",
  description:
    "Autonomous crypto market intelligence agent. Real-time prices, AI alpha signals, and onchain execution on X Layer.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
