import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "QuantPilot",
  description: "Backtest trading strategies on historical data.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <Link href="/" className="brand">
            QuantPilot
          </Link>
          <span className="muted">Strategy backtesting</span>
        </header>
        <main className="page">{children}</main>
        <footer className="footer" data-testid="disclaimer">
          Results are historical simulations, not investment advice. Past performance does not
          predict future returns. Data excludes delisted tickers (survivorship bias).
        </footer>
      </body>
    </html>
  );
}
