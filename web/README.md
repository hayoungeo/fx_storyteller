# Exchange Signal Web

뉴스·거시 지표·SV 변동성 데이터를 사용자의 자산 또는 목적에 맞춰 보여주는 Next.js 웹 앱입니다.

## 로컬 실행

```bash
pnpm install
pnpm dev
```

Groq AI 요약을 사용하려면 `.env.local`에 다음 값을 설정합니다.

```text
GROQ_API_KEY=gsk_...
GROQ_MODEL=llama-3.1-8b-instant
```

키가 없거나 Groq 호출이 실패해도 데이터 기반 요약으로 동작합니다.

## 웹 데이터 갱신

프로젝트 루트에서 실행합니다.

```bash
python web/scripts/export_web_data.py
```

이 명령은 기존 분석 결과 중 공개 화면에 필요한 필드만 `web/data/generated/analysis-data.json`에 저장합니다. `user_assets.json`은 읽거나 포함하지 않습니다.

## Vercel 배포

1. 저장소를 GitHub에 올립니다.
2. Vercel에서 저장소를 Import합니다.
3. Root Directory를 `web`으로 설정합니다.
4. `GROQ_API_KEY`와 선택적으로 `GROQ_MODEL`, `NEXT_PUBLIC_SITE_URL`을 Environment Variables에 추가합니다.
5. Production 배포를 실행합니다.

데이터 자동 갱신을 사용하려면 GitHub 저장소 Secrets에 `NEWSAPI_KEY`, `GROQ_API_KEY`, `FRED_API_KEY`, `ECOS_API_KEY`, `EXIM_API_KEY`를 설정합니다.
