import { StrategyForm } from "./StrategyForm";

export default function HomePage() {
  return (
    <>
      <h1>RSI mean-reversion backtest</h1>
      <p className="lede">
        Buys when RSI falls below the entry level and sells when it rises above the exit level.
        Orders fill at the next day&apos;s open, after commission and slippage.
      </p>
      <StrategyForm />
    </>
  );
}
