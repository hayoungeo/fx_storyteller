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
  const spot = volatility.spot_rate * factor;
  const move = volatility.estimated_monthly_move_rate * factor;
  const format = (value: number) => value.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
  return {
    currentRateText: `${foreignUnit}당 약 ${format(spot)}원`,
    monthlyRangeText: `${foreignUnit}당 약 ${format(Math.max(0, spot - move))}원에서 ${format(spot + move)}원`,
    meaning: `${foreignUnit}를 사는 데 필요한 원화 금액이 이 범위만큼 달라질 수 있다는 뜻`,
  };
}

function compactAvailableData(value: unknown): unknown {
  if (value === null || value === undefined || value === "" || value === "데이터 부족" || value === "데이터없음") return undefined;
  if (Array.isArray(value)) {
    const items = value.map(compactAvailableData).filter((item) => item !== undefined);
    return items.length ? items : undefined;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => [key, compactAvailableData(item)] as const)
      .filter(([, item]) => item !== undefined);
    return entries.length ? Object.fromEntries(entries) : undefined;
  }
  return value;
}

function fallbackCopy(subject: string, volatility: VolatilityRow, evidence: Evidence[]) {
  const rate = buildRatePresentation(volatility.currency_pair, volatility);
  const newsText = evidence.length
    ? `최근 관련 뉴스 ${evidence.length}건도 함께 살펴봤습니다.`
    : "직접 연결되는 최신 뉴스가 적어 환율 움직임을 중심으로 살펴봤습니다.";
  const summary = `${newsText} ${subject}과 관련된 현재 환율은 ${rate.currentRateText}입니다. ${volatility.reference_date} 기준 환율의 흔들림은 한 달에 약 ${volatility.monthly_volatility_pct.toFixed(2)}%로, 원화로 보면 ${rate.monthlyRangeText}에 해당합니다. 1년 기준으로 환산한 움직임 크기는 ${volatility.annualized_volatility_pct.toFixed(2)}%이며, 과거 관측일 100일 중 약 ${volatility.historical_percentile.toFixed(0)}일보다 움직임이 큰 수준입니다. 이는 ${rate.meaning}일 뿐, 이번 뉴스와 지표만으로는 환율 방향을 단정하기 어렵습니다. 이 수치는 실제 옵션시장의 전망이 아니라 과거 환율 움직임으로 추정한 값이며, 원화 범위도 확정값이 아닌 통계적 참고치입니다.`;
  return { summary, action: "필요한 외화를 한 번에 바꾸기보다 시기를 2~3번으로 나누고, 예상 원화 예산에도 여유를 두세요." };
}

async function generateWithGroq(subject: string, pair: CurrencyPair, volatility: VolatilityRow, evidence: Evidence[], fallback: { summary: string; action: string }) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return { ...fallback, mode: "data-fallback" as const };
  const ratePresentation = buildRatePresentation(pair, volatility);
  const requiredRateSentence = `${subject}과 관련된 현재 환율은 ${ratePresentation.currentRateText}이며, 최근 움직임을 기준으로 한 한 달 통계 범위는 ${ratePresentation.monthlyRangeText}입니다.`;
  const selectedNews = evidence.map(({ id, title, country, category, reason }) => {
    const detail = (analysisData.news as NewsRow[]).find((item) => item.id === id && item.title === title);
    return { title, summary: detail?.summary || "", country, category, reason };
  });
  const prompt = {
    subject, currencyPair: pair,
    userFriendlyRate: ratePresentation,
    requiredRateSentence,
    volatility: {
      referenceDate: volatility.reference_date,
      spotRateKrw: volatility.spot_rate,
      annualizedPct: volatility.annualized_volatility_pct,
      monthlyPct: volatility.monthly_volatility_pct,
      estimatedMonthlyMoveKrw: volatility.estimated_monthly_move_rate,
      estimatedMonthlyRangeKrw: {
        low: Math.max(0, volatility.spot_rate - volatility.estimated_monthly_move_rate),
        high: volatility.spot_rate + volatility.estimated_monthly_move_rate,
      },
      historicalPercentile: volatility.historical_percentile,
      isProxy: volatility.is_proxy,
    },
    macroIndicators: compactAvailableData({
      rateDiffs: analysisData.macro.rate_diffs,
      fxTechnical: analysisData.macro.fx_technical,
      otherIndicators: analysisData.macro.other_indicators,
    }),
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
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `당신은 환율 뉴스를 사용자의 목적에 맞게 쉽게 설명하는 금융 어시스턴트입니다.

사용자는 해외여행, 유학, 투자, 출장, 해외직구 등의 목적을 가지고 있습니다. 제공된 뉴스, 거시 지표, 환율 변동성 수치를 종합하여 이 목적에 어떤 영향을 줄 수 있는지 자연스럽게 설명하세요.

규칙
1. 뉴스를 하나씩 요약하지 말고, 여러 뉴스를 하나의 흐름으로 종합해서 설명하세요.
2. 설명 순서는 뉴스의 핵심 내용, 환율 또는 해당 국가 경제에 미칠 가능성, 사용자의 목적에 미칠 영향, 참고하면 좋을 점 순서로 작성하세요.
3. 반드시 제공된 뉴스, 거시 지표, 변동성 수치만을 근거로 설명하세요. 자료에 없는 사실이나 경제 시나리오를 만들지 말고, 대학 입학·취업·생활비·등록금 등은 뉴스에 직접 언급된 경우에만 설명하세요.
4. 환율 방향은 뉴스 또는 거시 지표에 근거가 있을 때만 설명하세요. 판단하기 어렵다면 "이번 뉴스와 지표만으로는 환율 방향을 단정하기 어렵습니다."라고 쓰세요.
5. 관세→물가→금리→환율처럼 자료에 없는 여러 단계의 인과관계를 만들지 말고 환율과 직접 관련된 영향만 설명하세요.
6. 투자나 즉시 환전을 추천하지 말고 중립적으로 설명하세요.
7. 금융 용어는 쉬운 한국어로 풀어 쓰세요. VIX, CPI, GDP 등은 쓸 수 있지만 일반인이 이해하기 어려운 말은 뜻을 함께 설명하세요.
8. 거시 지표는 뉴스의 배경 정보로만 사용하세요. 값을 나열하거나 지표만으로 새로운 원인과 예측을 만들지 말고, 데이터가 없으면 언급하지 마세요.
9. 변동성 정보에서는 1년 기준으로 환산한 움직임 크기(%), 과거 100일 중 몇 일보다 큰지, 한 달 기준 움직임(%), 현재 환율 기준 원화 범위를 구체적인 숫자로 한 번씩 언급하세요.
10. 변동성은 방향이 아니라 흔들림의 크기입니다. 실제 옵션 내재변동성이 아닌 과거 환율 움직임으로 추정한 값이며, 원화 범위는 확정 범위가 아닌 통계적 환산값이라고 짧게 밝히세요.
11. 변동성 기준일을 언급하고, 오래된 정보라는 경고가 있으면 현재 수치처럼 표현하지 마세요.
12. 여행·유학·출장·해외직구 목적에서는 원화 환산 금액의 불확실성이 커지거나 작아질 수 있다는 의미까지만 설명하세요.
13. 숫자를 보고서처럼 나열하지 말고 먼저 쉬운 말로 의미를 설명한 다음 핵심 수치를 제시하세요.
14. "연율화", "백분위", "%p", "SV"를 단독으로 쓰지 말고 각각 쉬운 뜻으로 풀어 쓰세요.
15. 통화 단위를 뒤집지 마세요. 특히 JPY/KRW는 반드시 100엔당 원화 금액으로 설명하고, userFriendlyRate의 원화 구간을 그대로 사용하세요.
16. 행동 제안은 환율 확인, 예산 여유 확보, 환전·송금 시점 분산처럼 위험을 관리하는 구체적인 행동만 제시하세요. 즉시 환전이나 투자를 권하지 마세요.

출력 형식
- 반드시 {"summary": string, "action": string} 두 키만 가진 JSON 객체를 출력하세요.
- summary는 제목이나 번호 없이 이어지는 자연스러운 문단 4~6문장으로 작성하세요.
- action은 반드시 "행동 제안:"으로 시작하는 한 문장으로 작성하세요. 화면에서는 summary 뒤에 표시되며, 둘을 합쳐 총 5~7문장이 됩니다.
- 같은 내용을 반복하지 말고, "~할 수 있습니다", "~가능성이 있습니다"처럼 단정하지 않은 표현을 사용하세요.`,
          },
          {
            role: "user",
            content: `아래 데이터를 일반 사용자가 한 번에 이해할 수 있는 생활 언어로 설명하세요. 뉴스 흐름을 먼저 설명하고, requiredRateSentence는 글자와 숫자를 바꾸지 말고 summary 안에 한 번만 넣으세요. macroIndicators가 비어 있거나 값이 없으면 거시 지표를 언급하지 마세요.\n\n근거 데이터:\n${JSON.stringify(prompt)}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(18_000),
    });
    if (!response.ok) return { ...fallback, mode: "data-fallback" as const };
    const body = await response.json();
    const raw = body?.choices?.[0]?.message?.content;
    const parsed = JSON.parse(raw);
    if (typeof parsed.summary !== "string" || typeof parsed.action !== "string") return { ...fallback, mode: "data-fallback" as const };
    const sentenceCount = parsed.summary
      .split(/[!?]+|(?<!\d)\.(?!\d)/)
      .filter((sentence: string) => sentence.trim()).length;
    const requiredValues = [
      requiredRateSentence,
      volatility.reference_date,
      volatility.annualized_volatility_pct.toFixed(2),
      volatility.monthly_volatility_pct.toFixed(2),
      volatility.historical_percentile.toFixed(0),
    ];
    if (sentenceCount < 4 || sentenceCount > 6 || requiredValues.some((value) => !parsed.summary.includes(value))) {
      return { ...fallback, mode: "data-fallback" as const };
    }
    const generatedAction = parsed.action.replace(/^행동 제안:\s*/, "").slice(0, 300);
    const action = /나누|2\s*[~～-]\s*3/.test(generatedAction) ? generatedAction : fallback.action;
    return { summary: parsed.summary.slice(0, 1200), action, mode: "ai" as const };
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
    if (input.mode === "asset") {
      pair = pairByCurrency[input.asset.currency];
      subject = input.asset.name || `${input.asset.currency} ${assetTypeLabel[input.asset.type] || "외화 자산"}`;
      categories = input.asset.sensitivities.map((item) => categoryBySensitivity[item]).filter(Boolean);
    } else {
      pair = pairByCountry[input.goal.country];
      subject = `${countryByPair[pair]} ${intentLabel[input.goal.intent] || "외화 계획"}`;
      categories = input.goal.intent === "investment" ? ["환율", "금리"] : ["환율", "금리", "지정학"];
      goalText = input.goal.text;
    }
    const volatility = (analysisData.volatility as Record<string, VolatilityRow>)[pair];
    if (!volatility) return NextResponse.json({ error: "해당 통화의 변동성 데이터가 아직 준비되지 않았습니다." }, { status: 503 });
    const evidence = selectEvidence(pair, categories, goalText);
    const fallback = fallbackCopy(subject, volatility, evidence);
    const generated = await generateWithGroq(subject, pair, volatility, evidence, fallback);
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
