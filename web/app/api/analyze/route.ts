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

function selectEvidence(pair: CurrencyPair, categories: string[], goalText = ""): Evidence[] {
  const country = countryByPair[pair];
  const tokens = goalText.split(/\s+/).filter((token) => token.length >= 2);
  return (analysisData.news as NewsRow[])
    .map((news) => {
      let score = Number(news.confidence) || 0;
      if (news.currencyPairs.includes(pair)) score += 2;
      if (news.country === country || news.country === "한국") score += 1;
      if (categories.includes(news.category)) score += 0.7;
      const text = `${news.title} ${news.summary}`;
      if (tokens.some((token) => text.includes(token))) score += 0.25;
      return { news, score };
    })
    .filter(({ news, score }) => score > 1.35 && news.url.startsWith("https://"))
    .sort((a, b) => b.score - a.score || b.news.publishedAt.localeCompare(a.news.publishedAt))
    .slice(0, 4)
    .map(({ news }) => ({
      id: news.id, title: news.title, source: news.source, url: news.url, publishedAt: news.publishedAt,
      country: news.country, category: news.category, confidence: news.confidence, reason: news.reason,
    }));
}

function buildMetrics(volatility: VolatilityRow): Metric[] {
  return [
    { label: "현재 환율", value: `${volatility.spot_rate.toLocaleString("ko-KR")}원`, note: `${volatility.currency_pair} · ${volatility.reference_date} 기준` },
    { label: "1년 환산 움직임", value: `${volatility.annualized_volatility_pct.toFixed(2)}%`, note: `${volatility.source}` },
    { label: "한 달 통계적 범위", value: `약 ±${volatility.estimated_monthly_move_rate.toLocaleString("ko-KR")}원`, note: `월 변동성 ${volatility.monthly_volatility_pct.toFixed(2)}% 환산` },
    { label: "과거 수준 비교", value: `상위 ${(100 - volatility.historical_percentile).toFixed(0)}%`, note: `과거 관측일 중 ${volatility.historical_percentile.toFixed(0)}%보다 큰 움직임` },
  ];
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
    monthlyRangeText: `${foreignUnit}당 약 ${format(Math.max(0, spot - move))}원에서 ${format(spot + move)}원`,
    meaning: `${foreignUnitObject} 사는 데 필요한 원화 금액이 이 범위만큼 달라질 수 있다는 뜻`,
  };
}

function fallbackCopy(subject: string, volatility: VolatilityRow, evidence: Evidence[]) {
  const newsText = evidence.length
    ? `최근 관련 뉴스 ${evidence.length}건도 함께 살펴봤습니다.`
    : "직접 연결되는 최신 뉴스가 적어 환율 움직임을 중심으로 살펴봤습니다.";
  const summary = `${newsText} ${buildVolatilitySummary(subject, volatility)}`;
  return { summary, action: "필요한 외화를 한 번에 바꾸기보다 시기를 2~3번으로 나누고, 예상 원화 예산에도 여유를 두세요." };
}

function buildVolatilitySummary(subject: string, volatility: VolatilityRow) {
  const rate = buildRatePresentation(volatility.currency_pair, volatility);
  return `${subject}과 관련된 현재 환율은 ${rate.currentRateText}이며, 최근 움직임을 기준으로 한 한 달 통계 범위는 ${rate.monthlyRangeText}입니다. ${volatility.reference_date} 기준 환율의 흔들림은 한 달에 약 ${volatility.monthly_volatility_pct.toFixed(2)}%이고, 1년 기준으로 환산한 움직임 크기는 ${volatility.annualized_volatility_pct.toFixed(2)}%로 과거 관측일 100일 중 약 ${volatility.historical_percentile.toFixed(0)}일보다 큰 수준입니다. 이는 ${rate.meaning}일 뿐 상승·하락 방향을 뜻하지 않으며, 실제 옵션시장의 전망이 아니라 과거 환율 움직임으로 추정한 값이므로 원화 범위도 확정값이 아닌 통계적 참고치입니다.`;
}

async function generateWithGroq(subject: string, userContext: Record<string, unknown>, pair: CurrencyPair, volatility: VolatilityRow, evidence: Evidence[], fallback: { summary: string; action: string }) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return { ...fallback, mode: "data-fallback" as const };
  const ratePresentation = buildRatePresentation(pair, volatility);
  const selectedNews = evidence.map(({ id, title, country, category, reason }) => {
    const detail = (analysisData.news as NewsRow[]).find((item) => item.id === id && item.title === title);
    return { title, summary: detail?.summary || "", country, category, reason };
  });
  const prompt = {
    userAssetSituation: { subject, ...userContext },
    currencyPair: pair,
    userFriendlyRate: ratePresentation,
    volatility: {
      referenceDate: volatility.reference_date,
      currentRate: ratePresentation.currentRateText,
      annualizedVolatilityPct: volatility.annualized_volatility_pct,
      monthlyVolatilityPct: volatility.monthly_volatility_pct,
      monthlyStatisticalRange: ratePresentation.monthlyRangeText,
      historicalPercentile: volatility.historical_percentile,
      historicalLevelExplanation: volatility.percentile_explanation,
      isSvProxy: volatility.is_proxy,
      isStale: volatility.is_stale,
      allowedActionGuidance: volatility.action_guidance,
    },
    news: selectedNews,
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
            content: `당신은 사용자의 자산 상황을 고려해 환율 뉴스를 쉽게 설명해주는
금융 어시스턴트입니다. 아래 뉴스들과 사용자 자산 정보를 보고, 이 뉴스가
사용자의 자산에 어떤 의미인지 자연스러운 한국어 3~5문장으로 설명하세요.

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
- 투자 조언(사라, 팔아라)을 하지 말고, 사실과 그 의미만 담백하게 설명하세요.
- "~일 수 있어요", "~에는 큰 변화가 없어요" 처럼 단정적이지 않은 톤을 쓰세요.
- 출력은 설명 문장만 출력하고, 다른 부연설명이나 따옴표는 붙이지 마세요.`,
          },
          {
            role: "user",
            content: `아래 입력만 사용해 설명하세요. 엔화는 userFriendlyRate에 적힌 것처럼 100엔당 원화 금액으로 표현하세요.\n\n${JSON.stringify(prompt)}`,
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
    const summary = (actionIndex >= 0 ? cleaned.slice(0, actionIndex) : cleaned).trim().slice(0, 1200);
    const generatedAction = actionIndex >= 0 ? cleaned.slice(actionIndex + "행동 제안:".length).trim().slice(0, 300) : "";
    return { summary: summary || fallback.summary, action: generatedAction || fallback.action, mode: "ai" as const };
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
      userContext = {
        mode: "목적",
        purpose: input.goal.text,
        country: input.goal.country,
        intent: intentLabel[input.goal.intent] || input.goal.intent,
        targetDate: input.goal.targetDate,
        plannedAmount: input.goal.plannedAmount,
        plannedCurrency: input.goal.plannedCurrency,
      };
    }
    const volatility = (analysisData.volatility as Record<string, VolatilityRow>)[pair];
    if (!volatility) return NextResponse.json({ error: "해당 통화의 변동성 데이터가 아직 준비되지 않았습니다." }, { status: 503 });
    const evidence = selectEvidence(pair, categories, goalText);
    const fallback = fallbackCopy(subject, volatility, evidence);
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
