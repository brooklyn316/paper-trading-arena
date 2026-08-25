import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Paper Trading Arena",
  description: "Algorithmic trading bots competing on Alpaca paper trading.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
