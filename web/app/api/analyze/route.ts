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

function fallbackCopy(subject: string, volatility: VolatilityRow, evidence: Evidence[]) {
  const spot = volatility.spot_rate;
  const move = volatility.estimated_monthly_move_rate;
  const low = Math.max(0, spot - move).toLocaleString("ko-KR", { maximumFractionDigits: 2 });
  const high = (spot + move).toLocaleString("ko-KR", { maximumFractionDigits: 2 });
  const spotText = spot.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
  const newsText = evidence.length
    ? `최근 관련 뉴스 ${evidence.length}건도 함께 살펴봤습니다.`
    : "직접 연결되는 최신 뉴스가 적어 환율 움직임을 중심으로 살펴봤습니다.";
  const summary = `${subject}과 관련된 현재 환율은 ${spotText}원입니다. 최근 움직임을 바탕으로 계산하면 앞으로 한 달 동안 약 ${low}원에서 ${high}원 사이로 움직일 수 있는 정도의 변동성이 관측됩니다. 이는 오르거나 내릴 방향을 맞힌 예측이 아니라, 평소보다 가격이 얼마나 흔들릴 수 있는지를 보여주는 참고 범위입니다. ${newsText} 이 값은 실제 옵션시장의 전망이 아니라 과거 환율로 계산한 추정치이므로 예산을 정할 때 참고용으로만 사용해 주세요.`;
  return { summary, action: "필요한 외화를 한 번에 바꾸기보다 시기를 2~3번으로 나누고, 예상 원화 예산에도 여유를 두세요." };
}

async function generateWithGroq(subject: string, pair: CurrencyPair, volatility: VolatilityRow, evidence: Evidence[], fallback: { summary: string; action: string }) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return { ...fallback, mode: "data-fallback" as const };
  const prompt = {
    subject, currencyPair: pair,
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
    news: evidence.map(({ title, country, category, reason }) => ({ title, country, category, reason })),
  };
  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || "llama-3.1-8b-instant",
        temperature: 0.25,
        max_tokens: 500,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `당신은 금융을 처음 접하는 사람에게 환율 정보를 설명하는 어시스턴트입니다.
제공된 근거만 사용하고, 반드시 {"summary": string, "action": string} 형태의 JSON 객체만 출력하세요.

summary 작성 규칙:
- 존댓말로 5문장 안팎을 쓰고, 한 문장은 짧게 작성하세요.
- 첫 문장에는 사용자의 자산이나 목적과 어떤 환율이 연결되는지 말하세요.
- 현재 환율과 한 달 예상 움직임을 원 단위로 말한 뒤, 쉬운 말로 의미를 풀어 주세요.
- "변동성", "연환산", "백분위", "SV 프록시", "내재변동성" 같은 용어를 설명 없이 사용하지 마세요.
- 변동성은 방향 예측이 아니라 흔들림의 크기라는 점을 분명히 하세요.
- 뉴스는 제목을 나열하지 말고 사용자 계획에 미칠 수 있는 영향을 한 문장으로 연결하세요.
- 이 수치는 옵션시장의 전망이 아니라 과거 환율 움직임으로 계산한 참고용 추정치라고 마지막에 알리세요.
- 공포를 조장하거나 상승·하락을 단정하지 마세요.

action 작성 규칙:
- 사용자가 오늘 바로 실천할 수 있는 위험 관리 행동을 한 문장으로 쓰세요.
- 매수·매도·즉시 환전을 단정적으로 권하지 마세요.`,
          },
          {
            role: "user",
            content: `아래 데이터를 일반 사용자가 한 번에 이해할 수 있는 생활 언어로 설명하세요. 숫자를 나열하지 말고 "그래서 내 계획에 어떤 의미인지"를 중심으로 작성하세요. 반드시 summary와 action 두 키만 출력하세요.\n\n근거 데이터:\n${JSON.stringify(prompt)}`,
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
    return { summary: parsed.summary.slice(0, 1200), action: parsed.action.replace(/^행동 제안:\s*/, "").slice(0, 300), mode: "ai" as const };
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
