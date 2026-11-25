# Glossary

Domain vocabulary only; rules live in [engineering.md](engineering.md).

| Term | Meaning in QuantPilot |
|---|---|
| Bar | One OHLCV row (open, high, low, close, volume) for one period, daily by default. |
| Strategy | A validated strategy definition (JSON, schema owned by `services/quant`) describing entry/exit rules, position sizing, and risk limits. |
| Signal | A boolean or numeric value computed per bar from indicators that says whether to enter or exit. |
| Fill | The simulated execution of an order: price, quantity, cost, slippage. |
| Backtest | Running a strategy over historical bars to produce trades, an equity curve, and metrics. |
| Lookahead bias | Using information at bar *t* that would not have been known until later. Forbidden (QP-STD-003). |
| Slippage | Difference between the expected price and the simulated fill price. |
| Equity curve | Portfolio value over time. |
| CAGR | Compound annual growth rate of the equity curve. |
| Sharpe ratio | Annualized mean excess return divided by annualized volatility of returns. |
| Max drawdown | Largest peak-to-trough fall of the equity curve, as a percentage. |
| Walk-forward | Repeated optimize-on-past, test-on-next-window validation to detect overfitting. |
| Benchmark | Buy-and-hold of the same ticker over the same period, shown with every result. |
