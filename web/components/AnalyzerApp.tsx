"use client";

import { FormEvent, useMemo, useState } from "react";
import type { AnalysisRequest, AnalysisResponse, Currency } from "@/lib/types";

type View = "landing" | "asset" | "goal" | "loading" | "result";

const currencyOptions: { value: Currency; label: string; sub: string }[] = [
  { value: "USD", label: "USD", sub: "미국 달러" },
  { value: "JPY", label: "JPY", sub: "일본 엔" },
  { value: "EUR", label: "EUR", sub: "유로" },
];

const quickGoals = [
  { label: "일본 여행", text: "3개월 뒤 일본 여행을 준비하고 있어요.", country: "JP", intent: "travel" },
  { label: "미국 유학", text: "미국 유학 비용과 환율 변동이 궁금해요.", country: "US", intent: "study" },
  { label: "유럽 출장", text: "유럽 출장을 앞두고 환율을 확인하고 싶어요.", country: "EU", intent: "business" },
] as const;

function ArrowIcon() {
  return <span aria-hidden="true" className="arrow-icon">↗</span>;
}

function Header({ dataAsOf, onHome }: { dataAsOf?: string; onHome: () => void }) {
  return (
    <header className="site-header">
      <button className="brand" onClick={onHome} aria-label="처음 화면으로 이동">
        <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
        <span>EXCHANGE SIGNAL</span>
      </button>
      <div className="header-meta">
        <span className="status-dot" aria-hidden="true" />
        <span>DATA AS OF</span>
        <strong>{dataAsOf || "2026-08-01"}</strong>
      </div>
    </header>
  );
}

function Landing({ onSelect }: { onSelect: (view: "asset" | "goal") => void }) {
  return (
    <main>
      <section className="hero shell">
        <div className="eyebrow"><span>FX INTELLIGENCE</span><span>NEWS · MACRO · VOLATILITY</span></div>
        <h1>환율 뉴스가<br />나에게 어떤 의미인지.</h1>
        <p className="hero-copy">
          막연한 전망 대신 뉴스와 변동성 데이터를 근거로,<br className="desktop-break" />
          내 자산과 계획에 필요한 의미만 정리합니다.
        </p>
        <div className="entry-grid" aria-label="분석 방식 선택">
          <button className="entry-card" onClick={() => onSelect("asset")}>
            <span className="card-index">01</span>
            <span className="card-rule" />
            <span className="card-title">내 자산 입력</span>
            <span className="card-description">외화 예금, 해외 주식 등<br />보유 자산의 환율 영향을 분석합니다.</span>
            <span className="card-action">자산 기준으로 시작 <ArrowIcon /></span>
          </button>
          <button className="entry-card" onClick={() => onSelect("goal")}>
            <span className="card-index">02</span>
            <span className="card-rule" />
            <span className="card-title">목적 입력</span>
            <span className="card-description">여행, 유학, 출장 등<br />앞으로 필요한 외화 계획을 분석합니다.</span>
            <span className="card-action">목적 기준으로 시작 <ArrowIcon /></span>
          </button>
        </div>
      </section>
      <section className="coverage shell" aria-label="지원 데이터">
        <div><span className="mini-label">COVERAGE</span><strong>USD/KRW · JPY/KRW · EUR/KRW</strong></div>
        <div><span className="mini-label">METHODOLOGY</span><strong>STOCHASTIC VOLATILITY PROXY</strong></div>
        <div><span className="mini-label">PRINCIPLE</span><strong>EVIDENCE BEFORE OPINION</strong></div>
      </section>
    </main>
  );
}

function StepHeader({ number, title, description, onBack }: { number: string; title: string; description: string; onBack: () => void }) {
  return (
    <div className="form-heading">
      <button className="back-button" onClick={onBack}>← 처음으로</button>
      <div className="step-label"><span>{number}</span> INPUT</div>
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
  );
}

function AssetForm({ onBack, onSubmit }: { onBack: () => void; onSubmit: (request: AnalysisRequest) => void }) {
  const [assetType, setAssetType] = useState("foreign_deposit");
  const [currency, setCurrency] = useState<Currency>("USD");
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [sensitivities, setSensitivities] = useState(["fx", "interest_rate"]);
  const amountNumber = Number(amount.replaceAll(",", ""));

  function toggleSensitivity(value: string) {
    setSensitivities((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) return;
    onSubmit({ mode: "asset", asset: { type: assetType, currency, name: name.trim() || undefined, amountKrw: amountNumber, sensitivities } });
  }

  return (
    <main className="form-page shell">
      <StepHeader number="01" title="분석할 자산을 입력하세요." description="입력 정보는 이번 분석에만 사용하며 저장하지 않습니다." onBack={onBack} />
      <form className="analysis-form" onSubmit={submit}>
        <div className="field wide-field">
          <label htmlFor="asset-type">자산 종류</label>
          <select id="asset-type" value={assetType} onChange={(e) => setAssetType(e.target.value)}>
            <option value="foreign_deposit">외화 예금</option>
            <option value="overseas_stock">해외 주식</option>
            <option value="overseas_etf">해외 ETF</option>
            <option value="bond">외화 채권</option>
            <option value="other">기타 외화 자산</option>
          </select>
        </div>
        <fieldset className="field wide-field">
          <legend>통화</legend>
          <div className="segmented-options">
            {currencyOptions.map((option) => (
              <button type="button" key={option.value} className={currency === option.value ? "selected" : ""} onClick={() => setCurrency(option.value)} aria-pressed={currency === option.value}>
                <strong>{option.label}</strong><span>{option.sub}</span>
              </button>
            ))}
          </div>
        </fieldset>
        <div className="field">
          <label htmlFor="asset-name">자산 이름 <span>선택</span></label>
          <input id="asset-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="예: 미국 주식 계좌" />
        </div>
        <div className="field">
          <label htmlFor="asset-amount">원화 평가금액</label>
          <div className="unit-input"><input id="asset-amount" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9,]/g, ""))} placeholder="10,000,000" required /><span>KRW</span></div>
        </div>
        <fieldset className="field wide-field">
          <legend>민감하게 보고 싶은 항목 <span>복수 선택</span></legend>
          <div className="check-row">
            {[{ value: "fx", label: "환율" }, { value: "interest_rate", label: "금리" }, { value: "trade", label: "무역" }, { value: "geopolitics", label: "지정학" }].map((item) => (
              <label key={item.value} className={sensitivities.includes(item.value) ? "checked" : ""}>
                <input type="checkbox" checked={sensitivities.includes(item.value)} onChange={() => toggleSensitivity(item.value)} />
                <span>{item.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="form-submit wide-field">
          <p><span className="privacy-mark">i</span> 이름과 금액은 서버에 저장되지 않습니다.</p>
          <button className="primary-button" type="submit" disabled={!Number.isFinite(amountNumber) || amountNumber <= 0}>입력 확인 및 분석하기 <ArrowIcon /></button>
        </div>
      </form>
    </main>
  );
}

function GoalForm({ onBack, onSubmit }: { onBack: () => void; onSubmit: (request: AnalysisRequest) => void }) {
  const [text, setText] = useState("");
  const [country, setCountry] = useState<"US" | "JP" | "EU">("JP");
  const [intent, setIntent] = useState("travel");
  const [targetDate, setTargetDate] = useState("");
  const [amount, setAmount] = useState("");
  const currency: Currency = country === "JP" ? "JPY" : country === "EU" ? "EUR" : "USD";
  const amountNumber = Number(amount.replaceAll(",", ""));

  function chooseQuickGoal(goal: typeof quickGoals[number]) {
    setText(goal.text); setCountry(goal.country); setIntent(goal.intent);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (text.trim().length < 3) return;
    onSubmit({ mode: "goal", goal: { text: text.trim(), country, intent, targetDate: targetDate || undefined, plannedAmount: amount && amountNumber > 0 ? amountNumber : undefined, plannedCurrency: amount ? currency : undefined } });
  }

  return (
    <main className="form-page shell">
      <StepHeader number="02" title="어떤 계획을 준비하고 있나요?" description="계획을 구체적으로 적을수록 필요한 통화의 영향을 더 정확하게 찾습니다." onBack={onBack} />
      <form className="analysis-form" onSubmit={submit}>
        <div className="field wide-field">
          <label htmlFor="goal-text">목적</label>
          <textarea id="goal-text" value={text} onChange={(e) => setText(e.target.value)} maxLength={200} required placeholder="예: 3개월 뒤 일본 여행을 준비하고 있어요." />
          <div className="quick-goals" aria-label="빠른 목적 선택">
            <span>빠른 선택</span>
            {quickGoals.map((goal) => <button type="button" key={goal.label} onClick={() => chooseQuickGoal(goal)}>{goal.label}</button>)}
          </div>
        </div>
        <div className="field">
          <label htmlFor="goal-country">국가·지역</label>
          <select id="goal-country" value={country} onChange={(e) => setCountry(e.target.value as "US" | "JP" | "EU")}>
            <option value="JP">일본 · JPY</option><option value="US">미국 · USD</option><option value="EU">유럽 · EUR</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="goal-intent">목적 유형</label>
          <select id="goal-intent" value={intent} onChange={(e) => setIntent(e.target.value)}>
            <option value="travel">여행</option><option value="study">유학</option><option value="business">출장</option><option value="shopping">해외직구</option><option value="investment">투자</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="goal-date">예상 시점 <span>선택</span></label>
          <input id="goal-date" type="month" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="goal-amount">예상 외화 지출액 <span>선택</span></label>
          <div className="unit-input"><input id="goal-amount" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9,]/g, ""))} placeholder="300,000" /><span>{currency}</span></div>
        </div>
        <div className="form-submit wide-field">
          <p><span className="privacy-mark">i</span> 목적과 금액은 서버에 저장되지 않습니다.</p>
          <button className="primary-button" type="submit" disabled={text.trim().length < 3}>입력 확인 및 분석하기 <ArrowIcon /></button>
        </div>
      </form>
    </main>
  );
}

function Loading() {
  return (
    <main className="loading-page shell" aria-live="polite">
      <div className="loading-kicker">ANALYSIS IN PROGRESS</div>
      <h1>근거를 확인하고 있습니다.</h1>
      <div className="loading-track"><span /></div>
      <ol className="loading-steps"><li className="done">입력 내용 확인</li><li className="done">관련 뉴스 선택</li><li className="active">변동성 및 거시 지표 결합</li><li>설명 생성</li></ol>
      <p>최근 데이터와 입력한 상황을 연결하고 있습니다.</p>
    </main>
  );
}

function Result({ result, onEdit, onReset }: { result: AnalysisResponse; onEdit: () => void; onReset: () => void }) {
  return (
    <main className="result-page shell">
      <div className="result-topbar">
        <div><span className="result-code">ANALYSIS / {result.subject.currencyPair}</span><h1>{result.subject.label}</h1></div>
        <div className="result-actions"><button onClick={onEdit}>입력 수정</button><button className="dark-button" onClick={onReset}>새 분석</button></div>
      </div>
      <div className="result-meta"><span>{result.subject.mode === "asset" ? "자산 분석" : "목적 분석"}</span><span>{result.subject.currencyPair}</span><span>기준일 {result.dataAsOf}</span><span>{result.generationMode === "ai" ? "AI GENERATED" : "DATA-BASED"}</span></div>
      <section className="summary-panel">
        <span className="section-number">01 / SUMMARY</span>
        <h2>핵심 설명</h2>
        <p>{result.summary}</p>
        <div className="action-box"><span>ACTION</span><strong>{result.action}</strong></div>
      </section>
      <section className="metrics-section">
        <div className="section-heading"><span className="section-number">02 / KEY NUMBERS</span><h2>현재 움직임의 크기</h2></div>
        <div className="metrics-grid">
          {result.metrics.map((metric) => <article className="metric-card" key={metric.label}><span>{metric.label}</span><strong>{metric.value}</strong><p>{metric.note}</p></article>)}
        </div>
      </section>
      <section className="evidence-section">
        <div className="section-heading"><span className="section-number">03 / EVIDENCE</span><h2>분석에 사용한 뉴스</h2><p>{result.evidence.length}건의 관련 근거</p></div>
        <div className="evidence-list">
          {result.evidence.map((item, index) => (
            <article className="evidence-item" key={item.id}>
              <span className="evidence-index">{String(index + 1).padStart(2, "0")}</span>
              <div><div className="evidence-tags"><span>{item.country}</span><span>{item.category}</span><span>신뢰도 {Math.round(item.confidence * 100)}%</span></div><h3>{item.title}</h3><p>{item.reason}</p><small>{item.source} · {item.publishedAt.slice(0, 10)}</small></div>
              {item.url.startsWith("https://") && <a href={item.url} target="_blank" rel="noreferrer" aria-label={`${item.title} 원문 열기`}><ArrowIcon /></a>}
            </article>
          ))}
        </div>
      </section>
      <section className="limitations"><span className="section-number">04 / LIMITATIONS</span><div>{result.limitations.map((item) => <p key={item}>{item}</p>)}</div></section>
    </main>
  );
}

export default function AnalyzerApp() {
  const [view, setView] = useState<View>("landing");
  const [request, setRequest] = useState<AnalysisRequest | null>(null);
  const [result, setResult] = useState<AnalysisResponse | null>(null);
  const [error, setError] = useState("");
  const dataAsOf = useMemo(() => result?.dataAsOf, [result]);

  async function analyze(nextRequest: AnalysisRequest) {
    setRequest(nextRequest); setError(""); setView("loading");
    try {
      const response = await fetch("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(nextRequest) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "분석을 완료하지 못했습니다.");
      setResult(payload); setView("result"); window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "잠시 후 다시 시도해 주세요.");
      setView(nextRequest.mode === "asset" ? "asset" : "goal");
    }
  }

  function reset() { setView("landing"); setRequest(null); setResult(null); setError(""); window.scrollTo({ top: 0, behavior: "smooth" }); }
  function edit() { if (request) setView(request.mode); }

  return (
    <div className="app-frame">
      <Header dataAsOf={dataAsOf} onHome={reset} />
      {error && <div className="error-banner" role="alert"><strong>분석을 완료하지 못했습니다.</strong><span>{error}</span><button onClick={() => setError("")}>닫기</button></div>}
      {view === "landing" && <Landing onSelect={setView} />}
      {view === "asset" && <AssetForm onBack={reset} onSubmit={analyze} />}
      {view === "goal" && <GoalForm onBack={reset} onSubmit={analyze} />}
      {view === "loading" && <Loading />}
      {view === "result" && result && <Result result={result} onEdit={edit} onReset={reset} />}
      <footer><div className="shell"><strong>EXCHANGE SIGNAL</strong><p>정보 제공 목적의 분석이며 환율 방향이나 수익을 보장하지 않습니다.</p><span>© 2026</span></div></footer>
    </div>
  );
}
