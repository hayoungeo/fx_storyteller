export type Currency = "USD" | "JPY" | "EUR";
export type CurrencyPair = "USD/KRW" | "JPY/KRW" | "EUR/KRW";

export type AssetRequest = {
  mode: "asset";
  asset: {
    type: string;
    currency: Currency;
    name?: string;
    amountKrw: number;
    sensitivities: string[];
  };
};

export type GoalRequest = {
  mode: "goal";
  goal: {
    text: string;
    country: "US" | "JP" | "EU";
    intent: string;
    targetDate?: string;
    plannedAmount?: number;
    plannedCurrency?: Currency;
  };
};

export type AnalysisRequest = AssetRequest | GoalRequest;

export type Metric = {
  label: string;
  value: string;
  note: string;
};

export type Evidence = {
  id: string;
  title: string;
  source: string;
  url: string;
  publishedAt: string;
  country: string;
  category: string;
  confidence: number;
  reason: string;
};

export type AnalysisResponse = {
  subject: { label: string; currencyPair: CurrencyPair; mode: "asset" | "goal" };
  summary: string;
  action: string;
  metrics: Metric[];
  evidence: Evidence[];
  limitations: string[];
  dataAsOf: string;
  generationMode: "ai" | "data-fallback";
};
