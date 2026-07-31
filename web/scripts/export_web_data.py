# -*- coding: utf-8 -*-
"""기존 분석 결과에서 웹 공개에 필요한 최소 데이터만 만든다."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "web" / "data" / "generated" / "analysis-data.json"


def load_news() -> list[dict]:
    rows = []
    with (ROOT / "processed_news.jsonl").open("r", encoding="utf-8") as stream:
        for line in stream:
            if not line.strip():
                continue
            item = json.loads(line)
            if not item.get("is_relevant"):
                continue
            rows.append({
                "id": item.get("id", ""),
                "title": item.get("title", ""),
                "summary": item.get("summary", "")[:500],
                "source": item.get("source", ""),
                "url": item.get("url", ""),
                "publishedAt": item.get("published_at", ""),
                "country": item.get("country", "기타"),
                "category": item.get("category", "기타"),
                "direction": item.get("direction", "중립"),
                "currencyPairs": item.get("currency_pairs") or [],
                "confidence": item.get("confidence", 0),
                "reason": item.get("reason", ""),
            })
    rows.sort(key=lambda row: row["publishedAt"], reverse=True)
    return rows[:150]


def main() -> None:
    import sys

    sys.path.insert(0, str(ROOT))
    from volatility_context import build_all_volatility_contexts

    macro_path = ROOT / "processed_macro.json"
    try:
        macro = json.loads(macro_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        macro = {}

    volatility = build_all_volatility_contexts()
    news = load_news()
    dates = [item["publishedAt"][:10] for item in news if item.get("publishedAt")]
    reference_dates = [
        str(item.get("reference_date", ""))
        for item in volatility.values()
        if item.get("reference_date")
    ]
    data_as_of = max([*dates, *reference_dates], default="")

    payload = {
        "metadata": {
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "dataAsOf": data_as_of,
            "supportedPairs": ["USD/KRW", "JPY/KRW", "EUR/KRW"],
            "method": "stochvol SV 기반 프록시",
        },
        "volatility": volatility,
        "macro": macro,
        "news": news,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    temp = OUTPUT.with_suffix(".tmp")
    temp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    temp.replace(OUTPUT)
    print(f"웹 데이터 저장 완료: {OUTPUT} ({len(news)}건)")


if __name__ == "__main__":
    main()
