"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { BacktestResult } from "@quantpilot/shared";
import { money } from "@/lib/format";

export function EquityChart({ points }: { points: BacktestResult["equity_curve"] }) {
  return (
    <div className="chart" data-testid="equity-chart">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fill: "var(--muted)", fontSize: 12 }}
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
            minTickGap={48}
          />
          <YAxis
            tick={{ fill: "var(--muted)", fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            width={72}
            domain={["auto", "auto"]}
            tickFormatter={(v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 0 })}
          />
          <Tooltip
            formatter={(v: number) => money(v)}
            contentStyle={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 6,
            }}
          />
          <Legend />
          <Line
            type="monotone"
            dataKey="equity"
            name="Strategy"
            stroke="var(--strategy)"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="benchmark"
            name="Buy & hold"
            stroke="var(--benchmark)"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
