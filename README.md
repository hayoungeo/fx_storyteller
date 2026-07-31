# Exchange Signal

뉴스, 거시 지표, 확률적 변동성(SV) 데이터를 사용자의 외화 자산 또는 목적에 맞춰 설명하는 환율 금융 AI 프로젝트입니다.

## 구성

- `web/`: Vercel에 배포하는 Next.js 웹 앱
- Python 수집·분석 코드: 뉴스, 환율, 거시 지표 전처리
- `estimate_sv_volatility.R`: stochvol 기반 변동성 추정
- `.github/workflows/`: 웹 빌드 검사와 분석 데이터 자동 갱신

웹 첫 화면에서는 기존 샘플 자산을 표시하지 않습니다. 사용자가 `내 자산 입력` 또는 `목적 입력` 중 하나를 선택한 뒤 분석 결과를 확인합니다. 입력 정보는 기본적으로 저장하지 않습니다.

## 웹 로컬 실행

```bash
cd web
pnpm install
pnpm dev
```

Groq AI 요약을 사용하려면 `web/.env.local`에 서버 전용 키를 설정합니다.

```text
GROQ_API_KEY=gsk_...
GROQ_MODEL=llama-3.1-8b-instant
```

키가 없거나 호출이 실패하면 데이터 기반 요약으로 안전하게 대체됩니다.

## Vercel 배포

1. Vercel에서 이 GitHub 저장소를 Import합니다.
2. 프로젝트의 Root Directory를 `web`으로 지정합니다.
3. `GROQ_API_KEY`를 Vercel Environment Variables에 추가합니다.
4. Production 배포를 실행합니다.

자세한 웹 실행과 배포 방법은 [web/README.md](web/README.md), 제품 설계는 [WEB_PAGE_SPEC.md](WEB_PAGE_SPEC.md)를 참고하세요.

## 주의

변동성은 환율의 상승·하락 방향이 아니라 움직임의 크기를 뜻합니다. 표시된 수치는 실제 옵션 내재변동성이 아닌 SV 기반 프록시이며, 금융 거래나 수익을 보장하지 않습니다.
