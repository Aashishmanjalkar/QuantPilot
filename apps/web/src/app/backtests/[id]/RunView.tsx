"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError, getBacktest, watchBacktest, type Run } from "@/lib/api";
import { money, num, pct } from "@/lib/format";
import { EquityChart } from "./EquityChart";

const STATUS_TEXT: Record<Run["status"], string> = {
  queued: "Queued",
  running: "Running backtest",
  completed: "Completed",
  failed: "Failed",
};

/** Errors that retrying cannot fix: stop polling and show them. */
const PERMANENT_ERRORS = new Set(["not_found", "bad_response", "validation_error"]);

export function RunView({ id }: { id: string }) {
  const [run, setRun] = useState<Run | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    // Socket dropped before a terminal state: poll over HTTP until the run finishes.
    const poll = () => {
      getBacktest(id)
        .then((r) => {
          if (!active) return;
          setRun(r);
          if (r.status === "queued" || r.status === "running") timer = setTimeout(poll, 2000);
        })
        .catch((err: unknown) => {
          if (!active) return;
          if (err instanceof ApiError && PERMANENT_ERRORS.has(err.body.code)) {
            setLoadError(err.message);
          } else {
            timer = setTimeout(poll, 5000); // transient: keep trying
          }
        });
    };

    // The socket sends the current state on connect, then every change.
    const stop = watchBacktest(
      id,
      (next) => active && setRun(next),
      (cleanEnd) => {
        if (active && !cleanEnd) poll();
      },
    );
    return () => {
      active = false;
      clearTimeout(timer);
      stop();
    };
  }, [id]);

  if (loadError) {
    return (
      <div className="error" role="alert">
        {loadError}
      </div>
    );
  }
  if (!run) return <p className="muted">Loading…</p>;

  const s = run.strategy;
  return (
    <>
      <p className="muted">
        <Link href="/">← New backtest</Link>
      </p>
      <h1>
        {s.name} · {s.ticker}
      </h1>
      <p className="lede">
        {s.start_date} to {s.end_date} · buy RSI({s.entry.period}) &lt; {s.entry.threshold}, sell
        RSI({s.exit.period}) &gt; {s.exit.threshold}
      </p>

      {run.status !== "completed" && (
        <section className="card" aria-live="polite">
          <h2 data-testid="run-status">{STATUS_TEXT[run.status]}</h2>
          {run.status === "failed" ? (
            <div className="error" role="alert">
              {run.error ?? "The backtest failed"}
            </div>
          ) : (
            <div
              className="progress"
              role="progressbar"
              aria-valuenow={run.progress}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <span style={{ width: `${Math.max(run.progress, 5)}%` }} />
            </div>
          )}
        </section>
      )}

      {run.status === "completed" && run.result && <Results run={run} />}
    </>
  );
}

function Results({ run }: { run: Run }) {
  const r = run.result!;
  const m = r.metrics;
  const tone = (v: number) => (v > 0 ? "pos" : v < 0 ? "neg" : undefined);
  const metrics: { label: string; value: string; className?: string }[] = [
    { label: "Total return", value: pct(m.total_return_pct), className: tone(m.total_return_pct) },
    {
      label: "Buy & hold",
      value: pct(m.benchmark_total_return_pct),
      className: tone(m.benchmark_total_return_pct),
    },
    { label: "CAGR", value: pct(m.cagr_pct) },
    { label: "Sharpe", value: num(m.sharpe) },
    { label: "Max drawdown", value: pct(-m.max_drawdown_pct), className: "neg" },
    { label: "Trades", value: String(m.num_trades) },
    { label: "Win rate", value: m.win_rate_pct === null ? "—" : `${m.win_rate_pct.toFixed(0)}%` },
    { label: "Time in market", value: `${m.exposure_pct.toFixed(0)}%` },
  ];

  return (
    <>
      <section className="card">
        <h2 data-testid="run-status">Results</h2>
        <dl className="metrics" data-testid="metrics">
          {metrics.map((x) => (
            <div key={x.label}>
              <dt>{x.label}</dt>
              <dd className={x.className}>{x.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="card">
        <h2>Equity curve</h2>
        <EquityChart points={r.equity_curve} />
        <p className="assumptions">
          {r.bars} daily bars ({r.start_date} to {r.end_date}),{" "}
          {r.assumptions.price_adjustment.replaceAll("_", " ")} prices from{" "}
          {r.assumptions.data_source}. Fills at next bar open; commission{" "}
          {r.assumptions.commission_bps} bps and slippage {r.assumptions.slippage_bps} bps per fill
          (total costs {money(m.total_costs)}). RSI warmed up on {r.assumptions.warmup_bars} earlier
          bars. An open position is valued at the last close, before exit costs. Benchmark: buy and
          hold from the first open.
        </p>
      </section>

      <section className="card">
        <h2>Trades</h2>
        {r.trades.length === 0 ? (
          <p className="muted">No trades: the entry condition never triggered.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Entry</th>
                  <th>Entry price</th>
                  <th>Exit</th>
                  <th>Exit price</th>
                  <th>P&amp;L</th>
                  <th>Return</th>
                </tr>
              </thead>
              <tbody>
                {r.trades.map((t, i) => (
                  <tr key={i}>
                    <td>{t.entry_date}</td>
                    <td>{money(t.entry_price)}</td>
                    <td>{t.exit_date ?? "open"}</td>
                    <td>{money(t.exit_price)}</td>
                    <td className={t.pnl === null ? undefined : tone(t.pnl)}>{money(t.pnl)}</td>
                    <td>{pct(t.return_pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
