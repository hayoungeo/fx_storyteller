import { NextResponse } from "next/server";
import { z } from "zod";
import analysisData from "@/data/generated/analysis-data.json";
import type { AnalysisResponse, CurrencyPair, Evidence, Metric } from "@/lib/types";

export const runtime = "nodejs";

const assetSchema = z.object({
  mode: z.literal("asset"),
  asset: z.object({
    type: z.string().min(1).max(40),
    currency: z.enum(["USD", "JPY", "EUR"]),
    name: z.string().trim().max(40).optional(),
    amountKrw: z.number().positive().max(100_000_000_000),
    sensitivities: z.array(z.enum(["fx", "interest_rate", "trade", "geopolitics"])).max(4),
  }),
});

const goalSchema = z.object({
  mode: z.literal("goal"),
  goal: z.object({
    text: z.string().trim().min(3).max(200),
    country: z.enum(["US", "JP", "EU"]),
    intent: z.enum(["travel", "study", "business", "shopping", "investment"]),
    targetDate: z.string().regex(/^\d{4}-\d{2}$/).optional(),
    plannedAmount: z.number().positive().max(100_000_000_000).optional(),
    plannedCurrency: z.enum(["USD", "JPY", "EUR"]).optional(),
  }),
});

const requestSchema = z.discriminatedUnion("mode", [assetSchema, goalSchema]);

type NewsRow = {
  id: string; title: string; summary: string; source: string; url: string; publishedAt: string;
  country: string; category: string; direction: string; currencyPairs: string[]; confidence: number; reason: string;
};

type VolatilityRow = {
  currency_pair: CurrencyPair; reference_date: string; annualized_volatility_pct: number;
  monthly_volatility_pct: number; historical_percentile: number; regime: string; percentile_explanation: string;
  spot_rate: number; estimated_monthly_move_rate: number; is_stale: boolean; is_proxy: boolean; source: string;
  action_guidance: string;
};

const pairByCurrency = { USD: "USD/KRW", JPY: "JPY/KRW", EUR: "EUR/KRW" } as const;
const pairByCountry = { US: "USD/KRW", JP: "JPY/KRW", EU: "EUR/KRW" } as const;
const countryByPair: Record<CurrencyPair, string> = { "USD/KRW": "미국", "JPY/KRW": "일본", "EUR/KRW": "유럽" };
const categoryBySensitivity: Record<string, string> = { fx: "환율", interest_rate: "금리", trade: "무역", geopolitics: "지정학" };
const intentLabel: Record<string, string> = { travel: "여행", study: "유학", business: "출장", shopping: "해외직구", investment: "투자" };
const assetTypeLabel: Record<string, string> = { foreign_deposit: "외화 예금", overseas_stock: "해외 주식", overseas_etf: "해외 ETF", bond: "외화 채권", other: "외화 자산" };
const requiredCurrencyByCountry = {
  US: { code: "USD", label: "달러" },
  JP: { code: "JPY", label: "엔화" },
  EU: { code: "EUR", label: "유로" },
} as const;

function selectMacroContext(pair: CurrencyPair) {
  const macro = analysisData.macro as unknown as Record<string, any>;
  const weekly = macro.weekly_fx_features || {};
  const weeklyKeys: Record<CurrencyPair, string[]> = {
    "USD/KRW": ["usd_krw", "us_policy_rate", "kr_policy_rate", "us_cpi_yoy", "kr_cpi_yoy", "us_kr_policy_spread", "us_kr_cpi_spread"],
    "JPY/KRW": ["jpy_krw", "jp_policy_rate", "kr_policy_rate", "jp_cpi_yoy", "kr_cpi_yoy", "us_jp_policy_spread", "us_jp_cpi_spread"],
    "EUR/KRW": ["eur_krw", "ea_policy_rate", "kr_policy_rate", "ea_cpi_yoy", "kr_cpi_yoy", "us_ea_policy_spread", "us_ea_cpi_spread"],
  };
  const indicatorKeys: Record<CurrencyPair, string[]> = {
    "USD/KRW": ["미국_국채10년물", "미국_CPI", "VIX", "미국국채10년물_야후", "유가_WTI", "한국_CPI"],
    "JPY/KRW": ["일본_CPI", "VIX", "유가_WTI", "한국_CPI"],
    "EUR/KRW": ["유럽_CPI", "VIX", "유가_WTI", "한국_CPI"],
  };
  return {
    computedAt: macro.computed_at,
    rateDifference: macro.rate_diffs?.[pair],
    fxTechnical: macro.fx_technical?.[pair],
    weeklyLatest: weekly.latest_week,
    weeklyFeatures: Object.fromEntries(weeklyKeys[pair].filter((key) => weekly[key]).map((key) => [key, weekly[key]])),
    japanPolicyRate: pair === "JPY/KRW" ? macro.japan_policy_rate : undefined,
    otherIndicators: Object.fromEntries(
      indicatorKeys[pair]
        .filter((key) => macro.other_indicators?.[key]?.latest !== null && macro.other_indicators?.[key]?.latest !== undefined)
        .map((key) => [key, macro.other_indicators[key]]),
    ),
  };
}

function selectEvidence(pair: CurrencyPair, categories: string[], goalText = ""): Evidence[] {
  const country = countryByPair[pair];
  const pairAliases: Record<CurrencyPair, string[]> = {
    "USD/KRW": ["USD/KRW"],
    "JPY/KRW": ["JPY/KRW", "USD/JPY"],
    "EUR/KRW": ["EUR/KRW", "EUR/USD", "USD/EUR"],
  };
  const tokens = goalText.split(/\s+/).filter((token) => token.length >= 2);
  return (analysisData.news as NewsRow[])
    .map((news) => {
      const text = `${news.title} ${news.summary}`;
      const countryKeywords: Record<CurrencyPair, RegExp> = {
        "USD/KRW": /미국|달러|United States|\bUSD\b|Fed/i,
        "JPY/KRW": /일본|엔화|Japan|\byen\b|\bJPY\b|BOJ/i,
        "EUR/KRW": /유럽|유로|Europe|Eurozone|\bEUR\b|ECB/i,
      };
      const hasPair = news.currencyPairs.includes(pair);
      const hasAliasWithContext = news.currencyPairs.some((item) => pairAliases[pair].includes(item)) && countryKeywords[pair].test(text);
      const directlyRelated = hasPair || news.country === country || hasAliasWithContext;
      let score = Number(news.confidence) || 0;
      if (news.currencyPairs.some((item) => pairAliases[pair].includes(item))) score += 2;
      if (news.country === country || news.country === "한국") score += 1;
      if (categories.includes(news.category)) score += 0.7;
      if (tokens.some((token) => text.includes(token))) score += 0.25;
      return { news, score, directlyRelated };
    })
    .filter(({ news, score, directlyRelated }) => directlyRelated && score > 1.35 && news.url.startsWith("https://"))
    .sort((a, b) => b.score - a.score || b.news.publishedAt.localeCompare(a.news.publishedAt))
    .slice(0, 4)
    .map(({ news }) => ({
      id: news.id, title: news.title, source: news.source, url: news.url, publishedAt: news.publishedAt,
      country: news.country, category: news.category, confidence: news.confidence, reason: news.reason,
    }));
}

function buildMetrics(volatility: VolatilityRow): Metric[] {
  const macro = selectMacroContext(volatility.currency_pair);
  const isYen = volatility.currency_pair === "JPY/KRW";
  const metrics: Metric[] = [
    { label: "현재 환율", value: `${(volatility.spot_rate * (isYen ? 100 : 1)).toLocaleString("ko-KR", { maximumFractionDigits: 2 })}원`, note: `${isYen ? "100엔" : volatility.currency_pair.split("/")[0]} 기준 · ${volatility.reference_date}` },
    { label: "1년 환산 움직임", value: `${volatility.annualized_volatility_pct.toFixed(2)}%`, note: `${volatility.source}` },
    { label: "한 달 통계적 범위", value: `약 ±${(volatility.estimated_monthly_move_rate * (isYen ? 100 : 1)).toLocaleString("ko-KR", { maximumFractionDigits: 2 })}원`, note: `${isYen ? "100엔" : "1단위 외화"} 기준 · 월 변동성 ${volatility.monthly_volatility_pct.toFixed(2)}%` },
    { label: "과거 수준 비교", value: `상위 ${(100 - volatility.historical_percentile).toFixed(0)}%`, note: `과거 관측일 중 ${volatility.historical_percentile.toFixed(0)}%보다 큰 움직임` },
  ];
  const rateDiff = macro.rateDifference as Record<string, unknown> | undefined;
  if (typeof rateDiff?.["금리차_pp"] === "number") {
    metrics.push({
      label: "한국-상대국 금리차",
      value: `${Number(rateDiff["금리차_pp"]).toFixed(2)}%p`,
      note: `${String(rateDiff["해석"] || "금리 수준 비교")} · ${macro.weeklyLatest || "최근"} 기준`,
    });
  }
  const weeklyPairKey: Record<CurrencyPair, string> = { "USD/KRW": "usd_krw", "JPY/KRW": "jpy_krw", "EUR/KRW": "eur_krw" };
  const weeklyRate = (macro.weeklyFeatures as Record<string, Record<string, unknown>>)?.[weeklyPairKey[volatility.currency_pair]];
  if (weeklyRate?.trend) {
    metrics.push({
      label: "주간 환율 흐름",
      value: String(weeklyRate.trend),
      note: `BIS 주간 데이터 · ${macro.weeklyLatest || "최근"} 기준`,
    });
  }
  return metrics;
}

function buildRatePresentation(pair: CurrencyPair, volatility: VolatilityRow) {
  const factor = pair === "JPY/KRW" ? 100 : 1;
  const foreignUnit = pair === "JPY/KRW" ? "100엔" : pair === "USD/KRW" ? "1달러" : "1유로";
  const foreignUnitObject = pair === "JPY/KRW" ? "100엔을" : pair === "USD/KRW" ? "1달러를" : "1유로를";
  const spot = volatility.spot_rate * factor;
  const move = volatility.estimated_monthly_move_rate * factor;
  const format = (value: number) => value.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
  return {
    currentRateText: `${foreignUnit}당 약 ${format(spot)}원`,
    monthlyMoveText: `${foreignUnit}당 약 ±${format(move)}원`,
    monthlyRangeText: `${foreignUnit}당 약 ${format(Math.max(0, spot - move))}원에서 ${format(spot + move)}원`,
    meaning: `${foreignUnitObject} 사는 데 필요한 원화 금액이 이 범위만큼 달라질 수 있다는 뜻`,
  };
}

function getNewsDetails(evidence: Evidence[]): NewsRow[] {
  return evidence
    .map(({ id, title }) => (analysisData.news as NewsRow[]).find((item) => item.id === id && item.title === title))
    .filter((item): item is NewsRow => Boolean(item));
}

function buildNewsContext(pair: CurrencyPair, news: NewsRow[]) {
  if (!news.length) {
    return {
      status: "none",
      lead: "현재 입력한 목적과 직접 관련된 최신 뉴스는 찾지 못했습니다. 아래 내용은 환율과 경제지표를 기준으로 설명합니다.",
      outputPrefix: "현재 입력한 목적과 직접 관련된 최신 뉴스는 찾지 못했습니다. 아래 내용은 환율과 경제지표를 기준으로 설명합니다.",
    };
  }
  const country = countryByPair[pair];
  const hasDirectNews = news.some((item) => item.country === country || item.currencyPairs.includes(pair));
  const themes: string[] = [];
  const facts: string[] = [];
  for (const item of news) {
    const text = `${item.title} ${item.summary} ${item.reason}`;
    const candidates: string[] = [];
    if (/yen falls|엔화.{0,8}(하락|약세)/i.test(text)) {
      candidates.push("엔화 약세");
      if (!facts.some((fact) => fact.includes("엔화"))) facts.push("엔화가 약세를 보였다는 내용이 전해졌습니다");
    }
    if (/(Fed|연준|연방준비제도).{0,30}(동결|유지)|금리.{0,12}(동결|유지)/i.test(text)) {
      candidates.push("미국 연준의 기준금리 동결");
      const detailedFed = /3[.]50.{0,10}3[.]75/.test(text) && /(three dissents|3명이|세 명|3대|9대 3)/i.test(text);
      const fact = detailedFed
        ? "미 연준이 기준금리를 3.50~3.75%로 동결했지만, 위원 3명이 다른 의견을 내 정책 판단이 한쪽으로 모이지 않았습니다"
        : "미 연준이 기준금리를 동결했습니다";
      if (!facts.some((existing) => existing.includes("미 연준"))) facts.push(fact);
    }
    if (/원[·・]?달러.{0,20}(하락|떨어|아래|최저)/i.test(text)) {
      candidates.push("원·달러 환율 하락");
      if (!facts.some((fact) => fact.includes("원·달러"))) facts.push("원·달러 환율이 하락했다는 소식도 함께 나왔습니다");
    }
    if (/(한국은행|한은).{0,20}금리.{0,12}인상/i.test(text)) {
      candidates.push("한국은행의 기준금리 인상");
      if (!facts.some((fact) => fact.includes("한국은행"))) facts.push("한국은행의 기준금리 인상 관련 발언이 보도됐습니다");
    }
    if (/관세/i.test(text)) {
      candidates.push("미국의 관세 부과");
      if (!facts.some((fact) => fact.includes("관세"))) facts.push("미국 관세 정책이 기업 비용에 미치는 영향을 다룬 뉴스가 있었습니다");
    }
    if (!candidates.length && item.reason) candidates.push(item.reason.replace(/[.。]+$/, ""));
    for (const candidate of candidates) if (!themes.includes(candidate)) themes.push(candidate);
  }
  const themeText = themes.slice(0, 3).join("·") || "환율 관련 움직임";
  const factText = facts.length
    ? facts.slice(0, 2).map((fact, index) => `${index ? "또한 " : "관련 뉴스에서는 "}${fact}.`).join(" ")
    : `관련 뉴스의 주요 내용은 ${themeText}입니다.`;
  if (!hasDirectNews) {
    const limitedLead = `입력 내용과 직접 연결되는 최신 뉴스는 제한적입니다. ${factText}`;
    return {
      status: "limited",
      lead: limitedLead,
      outputPrefix: limitedLead,
    };
  }
  return { status: "direct", lead: factText, outputPrefix: factText };
}

function assetSpecificExplanation(userContext: Record<string, unknown>) {
  const assetType = String(userContext.assetType || "외화 자산");
  const amount = typeof userContext.amountKrw === "number"
    ? `입력한 원화 평가금액 ${Number(userContext.amountKrw).toLocaleString("ko-KR")}원은 `
    : "이 자산의 원화 평가금액은 ";
  if (assetType === "해외 주식" || assetType === "해외 ETF") {
    return `${amount}주가 자체의 움직임과 환율의 영향을 함께 받습니다. 여기서는 주가를 예측하지 않고, 외화로 표시된 평가금액을 원화로 바꿔 볼 때 생기는 환율 영향만 설명합니다.`;
  }
  if (assetType === "외화 예금") {
    return `${amount}예금 이자와 별개로 환율의 영향을 받습니다. 예금 금리는 해당 통화 국가의 금리 환경과 연결되고, 원화 환산 평가금액은 환율에 따라 달라질 수 있습니다.`;
  }
  if (assetType === "외화 채권") {
    return `${amount}채권 가격과 이자 변화뿐 아니라 환율의 영향도 받습니다. 여기서는 채권 가격을 예측하지 않고 원화 환산 평가금액에 미치는 환율 영향만 설명합니다.`;
  }
  return `${amount}외화 자체의 가치 변화와 원화 환산 환율의 영향을 받을 수 있습니다.`;
}

function fallbackCopy(subject: string, volatility: VolatilityRow, evidence: Evidence[], mode: "asset" | "goal", userContext: Record<string, unknown>) {
  const newsContext = buildNewsContext(volatility.currency_pair, getNewsDetails(evidence));
  const assetExplanation = mode === "asset" ? ` ${assetSpecificExplanation(userContext)}` : "";
  const summary = `${newsContext.lead}${assetExplanation} ${buildVolatilitySummary(subject, volatility, mode)}`;
  const action = mode === "asset"
    ? "보유한 외화 자산의 원화 환산 평가금액이 환율 변화에 얼마나 노출되는지 정기적으로 확인하세요."
    : "필요한 외화를 한 번에 바꾸기보다 시기를 2~3번으로 나누고, 예상 원화 예산에도 여유를 두세요.";
  return { summary, action };
}

function buildVolatilitySummary(subject: string, volatility: VolatilityRow, mode: "asset" | "goal") {
  const rate = buildRatePresentation(volatility.currency_pair, volatility);
  const meaning = mode === "asset"
    ? "이는 환율이 이 범위만큼 흔들리면서 보유 외화 자산의 원화 환산 평가금액에도 영향을 줄 수 있다는 뜻"
    : `이는 ${rate.meaning}`;
  return `${subject}과 관련된 현재 환율은 ${rate.currentRateText}이며, 최근 움직임을 기준으로 한 한 달 통계 범위는 ${rate.monthlyRangeText}입니다. ${volatility.reference_date} 기준 환율의 흔들림은 한 달에 약 ${volatility.monthly_volatility_pct.toFixed(2)}%이고, 1년 기준으로 환산한 움직임 크기는 ${volatility.annualized_volatility_pct.toFixed(2)}%로 과거 관측일 100일 중 약 ${volatility.historical_percentile.toFixed(0)}일보다 큰 수준입니다. ${meaning}일 뿐 상승·하락 방향을 뜻하지 않으며, 실제 옵션시장의 전망이 아니라 과거 환율 움직임으로 추정한 값이므로 원화 범위도 확정값이 아닌 통계적 참고치입니다.`;
}

function normalizeSentence(value: string) {
  return value
    .toLowerCase()
    .replace(/행동\s*제안\s*:/g, "")
    .replace(/[^0-9a-z가-힣]/g, "");
}

function sentenceSimilarity(left: string, right: string) {
  const a = normalizeSentence(left);
  const b = normalizeSentence(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (Math.min(a.length, b.length) >= 18 && (a.includes(b) || b.includes(a))) return 0.95;
  const aChunks = new Set(Array.from({ length: Math.max(0, a.length - 2) }, (_, index) => a.slice(index, index + 3)));
  const bChunks = new Set(Array.from({ length: Math.max(0, b.length - 2) }, (_, index) => b.slice(index, index + 3)));
  if (!aChunks.size || !bChunks.size) return 0;
  let shared = 0;
  for (const chunk of aChunks) if (bChunks.has(chunk)) shared += 1;
  return shared / Math.min(aChunks.size, bChunks.size);
}

function removeRepeatedSentences(value: string, action = "") {
  const sentences = value.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean);
  const kept: string[] = [];
  for (const sentence of sentences) {
    const repeatsAction = action && sentenceSimilarity(sentence, action) >= 0.78;
    const repeatsEarlier = kept.some((earlier) => sentenceSimilarity(sentence, earlier) >= 0.88);
    if (!repeatsAction && !repeatsEarlier) kept.push(sentence);
  }
  return kept.join(" ").trim();
}

async function generateWithGroq(subject: string, userContext: Record<string, unknown>, pair: CurrencyPair, volatility: VolatilityRow, evidence: Evidence[], fallback: { summary: string; action: string }) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return { ...fallback, mode: "data-fallback" as const };
  const ratePresentation = buildRatePresentation(pair, volatility);
  const selectedNews = getNewsDetails(evidence);
  const newsContext = buildNewsContext(pair, selectedNews);
  const isAssetMode = userContext.mode === "자산";
  const assetGuidance = isAssetMode ? assetSpecificExplanation(userContext) : "";
  const analysisRole = isAssetMode
    ? `이 요청은 보유 자산 분석입니다. 사용자가 여행·유학·출장 등의 계획을 입력한 것이 아닙니다. 자산 이름에 국가명이 있어도 여행이나 지출 목적을 추측하지 마세요. 자산별 해석 기준은 다음과 같습니다: ${assetGuidance}`
    : `이 요청은 사용 목적 분석입니다. 보유 자산을 입력한 것이 아니므로 자산 보유나 원화 환산 가치를 추측하지 말고, 목적에 필요한 외화를 마련할 때의 원화 비용과 불확실성만 설명하세요.`;
  const prompt = {
    userAssetSituation: { subject, ...userContext },
    currencyPair: pair,
    userFriendlyRate: ratePresentation,
    volatility: {
      referenceDate: volatility.reference_date,
      currentRate: ratePresentation.currentRateText,
      annualizedVolatilityPct: volatility.annualized_volatility_pct,
      monthlyVolatilityPct: volatility.monthly_volatility_pct,
      monthlyStatisticalMove: ratePresentation.monthlyMoveText,
      monthlyStatisticalRange: ratePresentation.monthlyRangeText,
      historicalPercentile: volatility.historical_percentile,
      historicalLevelExplanation: volatility.percentile_explanation,
      isSvProxy: volatility.is_proxy,
      isStale: volatility.is_stale,
      allowedActionGuidance: volatility.action_guidance,
    },
    macroContext: selectMacroContext(pair),
    newsStatus: newsContext.status,
    news: selectedNews.map(({ title, summary, country, category, reason }) => ({ title, summary, country, category, reason })),
  };
  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || "llama-3.1-8b-instant",
        temperature: 0.25,
        max_tokens: 700,
        messages: [
          {
            role: "system",
            content: `당신은 사용자가 입력한 자산 또는 목적을 구분하여 환율 뉴스를 쉽게 설명해주는
금융 어시스턴트입니다. ${analysisRole}
아래 뉴스와 입력 정보를 보고 자연스러운 한국어 3~5문장으로 설명하세요.

반드시 지켜야 할 방향성 규칙 (틀리기 쉬우니 특히 주의):
1. "원화 약세(환율 상승, 예: 1,400원 -> 1,450원)"가 되면, 달러/엔화/유로 등
   외화로 표시된 자산(예금, 주식)의 "원화 환산 가치"는 오히려 상승할 가능성이
   있습니다. 반대로 "원화 강세(환율 하락)"가 되면 원화 환산 가치는 하락할
   가능성이 있습니다. 이 방향을 절대 거꾸로 설명하지 마세요.
2. 예금 상품의 "적용 금리(이자율)"는 그 예금이 표시된 통화를 발행한 국가의
   기준금리에 영향을 받습니다. 예를 들어 엔화 적금의 금리는 일본은행 정책에
   영향받는 것이지, 한국은행 기준금리가 엔화 적금의 이자율 자체를 바꾸지는
   않습니다. 다만 한국은행 정책은 원/엔 환율을 통해 그 적금의 "원화 환산
   평가금액"에는 영향을 줄 수 있습니다. 이자율에 대한 영향과 환산 평가금액에
   대한 영향을 혼동해서 설명하지 마세요.
3. 무역 분쟁/관세 뉴스처럼 특정국 통화 약세 요인이 있으면, 그 나라 통화
   자산과 원화 자산에 미치는 영향 방향이 다를 수 있다는 점을 고려하세요.
4. 변동성 정보가 제공되면 연율화 변동성 수치(%), 과거 백분위 또는 구간,
   월간 환산 변동성(%)을 구체적인 숫자로 반드시 한 번 이상 언급하세요.
5. 현재 환율 기준 월간 통계적 변동 폭(±원)이 제공되면 그 숫자도 언급하세요.
6. 변동성은 환율의 상승·하락 방향이 아니라 움직임의 크기입니다. 변동성이
   높다는 이유만으로 환율 상승 또는 하락을 예측하지 마세요.
7. 변동성 수치는 실제 옵션 내재변동성이 아니라 SV 기반 프록시라는 점과,
   ±원은 확정 범위가 아닌 통계적 환산값이라는 점을 짧게 밝히세요.
8. 변동성 정보에 기준일이 있으면 기준일을 함께 언급하고, 오래된 정보라는
   경고가 있으면 현재 수치처럼 표현하지 마세요.
9. 숫자를 보고서처럼 나열하지 마세요. 먼저 "평소보다 환율 움직임이 큰 편"
   또는 "한 달 기준 약 ±45원 정도의 통계적 움직임에 해당"처럼 쉬운 말로
   의미를 설명한 뒤 괄호나 이어지는 문장에서 핵심 수치를 제시하세요.
10. "연율화", "백분위", "%p", "SV" 같은 용어를 단독으로 쓰지 말고,
    각각 "1년 기준으로 환산한 움직임 크기", "과거 100일 중 몇 일보다 큰지",
    "변동성 차이", "과거 환율 움직임으로 추정한 값"이라는 뜻을 풀어주세요.
11. 변동성 관련 숫자는 가장 이해하기 쉬운 2~3개를 중심으로 설명하고,
    모든 통계값을 억지로 한 문장에 나열하지 마세요.
12. 마지막 문장은 반드시 "행동 제안:"으로 시작하는 한 문장으로 작성하세요.
    제공된 변동성 정보의 허용되는 행동 제안을 자산 상황에 맞게 쉽게 바꾸되,
    환율 확인, 예산 여유 확보, 환전·송금 시점 분산, 환율 노출 확인처럼 위험을
    관리하는 행동만 제시하세요. 매수·매도, 특정 환율 방향에 대한 베팅,
    수익을 보장하는 표현은 사용하지 마세요.

일반 규칙:
- 반드시 주어진 뉴스 내용에 근거해서만 설명하세요. 뉴스에 없는 내용을 지어내지 마세요.
- 뉴스의 핵심 사실과 관련성 안내는 서버가 출력 앞에 별도로 붙입니다. 출력에서는 뉴스를 다시 요약하거나 같은 사건을 반복하지 말고, 해당 뉴스와 환율 흔들림이 입력한 자산 종류 또는 목적에 어떤 의미인지 곧바로 연결하세요. newsStatus가 none이면 뉴스에 근거한 설명을 만들지 마세요.
- macroContext는 뉴스 내용을 직접 뒷받침할 때만 배경 근거로 사용하고, 값이 없는 지표는 언급하지 마세요.
- 투자 조언(사라, 팔아라)을 하지 말고, 사실과 그 의미만 담백하게 설명하세요.
- "~일 수 있어요", "~에는 큰 변화가 없어요" 처럼 단정적이지 않은 톤을 쓰세요.
- 출력은 설명 문장만 출력하고, 다른 부연설명이나 따옴표는 붙이지 마세요.`,
          },
          {
            role: "user",
            content: `아래 입력만 사용해 설명하세요. userAssetSituation.mode를 최우선으로 따르고 자산과 목적을 서로 바꾸어 해석하지 마세요. 자산 모드에서는 여행·유학·출장·해외직구 계획을 만들어내지 말고 assetType과 amountKrw를 반영해 자산별로 다르게 설명하세요. 해외 주식·ETF는 주가 자체의 변화와 환율 영향을 구분하고, 외화 예금은 이자율과 환율 영향을 구분하며, 외화 채권은 채권 가격·이자와 환율 영향을 구분하세요. 목적 모드에서는 사용자가 외화 자산을 보유한다고 추측하지 마세요. 뉴스의 구체적인 핵심 사실은 서버가 앞에 붙이므로 출력에서 뉴스를 다시 요약하지 말고 그 의미부터 설명하세요. 규칙 설명에 나온 1,400원, 1,450원, ±45원은 형식 예시일 뿐이므로 출력에 사용하지 마세요. 모든 숫자는 아래 입력값만 사용하고, 엔화는 userFriendlyRate에 적힌 것처럼 100엔당 원화 금액으로 표현하세요. macroContext는 뉴스와 직접 관련된 지표만 골라 자연스럽게 사용하세요. userAssetSituation.mode가 "목적"이면 "자산", "원화 환산 가치"라는 표현을 사용하지 마세요. requiredCurrencyLabel이 사용자가 실제로 준비해야 하는 외화이며, 원화는 그 외화를 사기 위한 예산과 환산 기준일 뿐입니다. 따라서 일본 여행에는 엔화, 미국 여행에는 달러, 유럽 여행에는 유로가 필요하다고 설명하세요. 같은 사실이나 행동을 표현만 바꾸어 두 번 쓰지 마세요.\n\n${JSON.stringify(prompt)}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(18_000),
    });
    if (!response.ok) return { ...fallback, mode: "data-fallback" as const };
    const body = await response.json();
    const raw = body?.choices?.[0]?.message?.content;
    if (typeof raw !== "string" || !raw.trim()) return { ...fallback, mode: "data-fallback" as const };
    const cleaned = raw.trim().replace(/^['"]|['"]$/g, "");
    const actionIndex = cleaned.lastIndexOf("행동 제안:");
    let summary = (actionIndex >= 0 ? cleaned.slice(0, actionIndex) : cleaned).trim().slice(0, 1200);
    let generatedAction = actionIndex >= 0 ? cleaned.slice(actionIndex + "행동 제안:".length).trim().slice(0, 300) : "";
    if (!generatedAction) {
      const sentences = summary.split(/(?<=[.!?])\s+/).filter(Boolean);
      const lastSentence = sentences.at(-1) || "";
      if (/(환율|환전|송금|결제|예산|시점).*(확인|여유|나누|분산|적절|좋|권장)/.test(lastSentence)) {
        generatedAction = lastSentence.replace(/[.!?]+$/, "").trim();
        summary = sentences.slice(0, -1).join(" ").trim();
      }
    }
    const requiredCurrencyLabel = userContext.requiredCurrencyLabel;
    if (userContext.mode === "목적" && typeof requiredCurrencyLabel === "string") {
      summary = summary.replace(/원화가 필요합니다[.]?/g, `${requiredCurrencyLabel}가 필요합니다.`);
      summary = summary.replace(new RegExp(`${requiredCurrencyLabel}\\s*자산`, "g"), requiredCurrencyLabel);
      summary = summary.replace(/외화 자산/g, requiredCurrencyLabel)
        .replace(/원화 환산 가치는/g, "원화 환산 비용은")
        .replace(/원화 환산 가치가/g, "원화 환산 비용이")
        .replace(/원화 환산 가치를/g, "원화 환산 비용을")
        .replace(/원화 환산 가치/g, "원화 환산 비용");
    }
    if (pair === "JPY/KRW") {
      const yenSpot = (volatility.spot_rate * 100).toLocaleString("ko-KR", { maximumFractionDigits: 2 });
      summary = summary
        .replace(`현재 약 ${yenSpot}원`, `현재 100엔당 약 ${yenSpot}원`)
        .replace(`현재 ${yenSpot}원`, `현재 100엔당 약 ${yenSpot}원`);
    }
    summary = summary.replace(/^newsContext[.]lead:\s*/i, "").trim();
    summary = removeRepeatedSentences(summary, generatedAction);
    const qualityFailed = summary.includes("비용는")
      || (summary.match(/원에서/g) || []).length > 1
      || (summary.match(/직접 연결되는 최신 뉴스는 제한적/g) || []).length > 0
      || /이유는.{0,50}위해서/.test(summary)
      || (userContext.mode === "목적" && /(자산|가 될 수 있는 원화|환산 기준일인|달러 1|유로 1|원화의 가치가 변동성이)/.test(summary))
      || (userContext.mode === "자산" && /(여행|유학|출장|해외직구).{0,12}(계획|준비|예정|필요)/.test(summary));
    if (qualityFailed) return { ...fallback, mode: "data-fallback" as const };
    summary = removeRepeatedSentences(`${newsContext.outputPrefix} ${summary}`.trim(), generatedAction);
    const unexpectedActionNumber = /\d/.test(generatedAction.replace(/2\s*[~～-]\s*3/g, ""));
    const action = generatedAction && !unexpectedActionNumber ? generatedAction : fallback.action;
    return { summary: summary || fallback.summary, action, mode: "ai" as const };
  } catch {
    return { ...fallback, mode: "data-fallback" as const };
  }
}

export async function POST(request: Request) {
  try {
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "입력 내용을 다시 확인해 주세요." }, { status: 400 });
    const input = parsed.data;
    let pair: CurrencyPair;
    let subject: string;
    let categories: string[];
    let goalText = "";
    let userContext: Record<string, unknown>;
    if (input.mode === "asset") {
      pair = pairByCurrency[input.asset.currency];
      subject = input.asset.name || `${input.asset.currency} ${assetTypeLabel[input.asset.type] || "외화 자산"}`;
      categories = input.asset.sensitivities.map((item) => categoryBySensitivity[item]).filter(Boolean);
      userContext = {
        mode: "자산",
        assetType: assetTypeLabel[input.asset.type] || "외화 자산",
        currency: input.asset.currency,
        amountKrw: input.asset.amountKrw,
        sensitivities: input.asset.sensitivities,
      };
    } else {
      pair = pairByCountry[input.goal.country];
      subject = `${countryByPair[pair]} ${intentLabel[input.goal.intent] || "외화 계획"}`;
      categories = input.goal.intent === "investment" ? ["환율", "금리"] : ["환율", "금리", "지정학"];
      goalText = input.goal.text;
      const requiredCurrency = requiredCurrencyByCountry[input.goal.country];
      userContext = {
        mode: "목적",
        purpose: input.goal.text,
        country: input.goal.country,
        intent: intentLabel[input.goal.intent] || input.goal.intent,
        requiredCurrency: requiredCurrency.code,
        requiredCurrencyLabel: requiredCurrency.label,
        targetDate: input.goal.targetDate,
        plannedAmount: input.goal.plannedAmount,
        plannedCurrency: input.goal.plannedCurrency,
      };
    }
    const volatility = (analysisData.volatility as Record<string, VolatilityRow>)[pair];
    if (!volatility) return NextResponse.json({ error: "해당 통화의 변동성 데이터가 아직 준비되지 않았습니다." }, { status: 503 });
    const evidence = selectEvidence(pair, categories, goalText);
    const fallback = fallbackCopy(subject, volatility, evidence, input.mode, userContext);
    const generated = await generateWithGroq(subject, userContext, pair, volatility, evidence, fallback);
    const result: AnalysisResponse = {
      subject: { label: subject, currencyPair: pair, mode: input.mode },
      summary: generated.summary,
      action: generated.action,
      metrics: buildMetrics(volatility),
      evidence,
      limitations: [
        "변동성은 환율의 상승·하락 방향이 아니라 움직임의 크기를 나타냅니다.",
        "표시된 범위는 실제 옵션 내재변동성이 아닌 SV 기반 프록시이며 결과를 보장하지 않습니다.",
      ],
      dataAsOf: analysisData.metadata.dataAsOf || volatility.reference_date,
      generationMode: generated.mode,
    };
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "분석 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." }, { status: 500 });
  }
}
