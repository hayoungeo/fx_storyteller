# -*- coding: utf-8 -*-
"""NewsAPI에서 환율 관련 뉴스를 수집해 collected_news.jsonl로 저장한다."""

import hashlib
import os
import time
from collections import Counter
from datetime import datetime, timezone

import requests
from dotenv import load_dotenv

from pipeline_utils import BASE_DIR, atomic_write_jsonl, run_cli, safe_error

load_dotenv(BASE_DIR / ".env")

NEWSAPI_KEY = os.environ.get("NEWSAPI_KEY")
BASE_URL = "https://newsapi.org/v2/everything"
OUTPUT_PATH = BASE_DIR / "collected_news.jsonl"

CATEGORY_QUERIES = {
    "금리": '(Fed OR FOMC OR "interest rate" OR "rate hike" OR "rate cut" OR 연준 OR 기준금리)',
    "무역": '(tariff OR "trade war" OR "trade deal" OR 관세 OR 무역분쟁)',
    "지정학": '(geopolitical OR sanctions OR war OR conflict OR 지정학 OR 제재)',
    "환율": '("exchange rate" OR currency OR dollar OR yen OR won OR 환율)',
}
LANGUAGES = ["en", "ko"]


def make_id(url: str) -> str:
    return hashlib.sha256(url.encode("utf-8")).hexdigest()[:16]


def fetch_category(category: str, query: str, language: str) -> list[dict]:
    params = {
        "q": query,
        "language": language,
        "sortBy": "publishedAt",
        "pageSize": 20,
        "apiKey": NEWSAPI_KEY,
    }
    response = requests.get(BASE_URL, params=params, timeout=15)
    response.raise_for_status()
    items = []
    for article in response.json().get("articles", []):
        url = article.get("url", "")
        title = article.get("title", "")
        if not url or not title:
            continue
        items.append({
            "id": make_id(url),
            "source": article.get("source", {}).get("name", "unknown"),
            "title": title,
            "summary": article.get("description") or "",
            "content": article.get("content") or "",
            "url": url,
            "published_at": article.get("publishedAt", ""),
            "tags": [category],
            "language": language,
            "collected_at": datetime.now(timezone.utc).isoformat(),
        })
    return items


def load_existing() -> list[dict]:
    if not OUTPUT_PATH.exists():
        return []
    items = []
    with OUTPUT_PATH.open("r", encoding="utf-8") as stream:
        for line in stream:
            if line.strip():
                import json
                items.append(json.loads(line))
    return items


def dedup_and_merge_tags(items: list[dict]) -> list[dict]:
    merged: dict[str, dict] = {}
    for item in items:
        key = item["id"]
        if key in merged:
            merged[key]["tags"] = sorted(
                set(merged[key].get("tags", [])) | set(item.get("tags", []))
            )
        else:
            merged[key] = item
    return sorted(merged.values(), key=lambda x: x.get("published_at", ""))


def collect_all() -> list[dict]:
    if not NEWSAPI_KEY:
        raise RuntimeError(".env 파일에 NEWSAPI_KEY를 설정하세요.")

    collected = []
    successful_requests = 0
    for category, query in CATEGORY_QUERIES.items():
        for language in LANGUAGES:
            try:
                items = fetch_category(category, query, language)
                successful_requests += 1
                collected.extend(items)
                print(f"[{category}/{language}] {len(items)}건 수집")
            except requests.RequestException as exc:
                print(f"[{category}/{language}] 실패: {safe_error(exc, [NEWSAPI_KEY])}")
            time.sleep(0.5)

    if successful_requests == 0:
        raise RuntimeError("모든 NewsAPI 요청이 실패해 기존 수집 파일을 보존합니다.")
    return dedup_and_merge_tags(load_existing() + collected)


def main() -> None:
    news = collect_all()
    atomic_write_jsonl(OUTPUT_PATH, news)
    print(f"저장 완료 -> {OUTPUT_PATH.resolve()} ({len(news)}건)")
    counts = Counter(tag for item in news for tag in item.get("tags", []))
    print("카테고리별 건수:", dict(counts))


if __name__ == "__main__":
    run_cli(main)
