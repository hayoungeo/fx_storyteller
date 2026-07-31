# -*- coding: utf-8 -*-
"""파이프라인 전반에서 공통으로 쓰는 안전한 저장·오류 처리 유틸리티."""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path
from typing import Any, Iterable


BASE_DIR = Path(__file__).resolve().parent


def configure_yfinance_cache() -> Path:
    """yfinance가 쓰기 가능한 프로젝트 내부 캐시를 사용하도록 설정한다."""
    import yfinance as yf

    cache_dir = BASE_DIR / ".cache" / "yfinance"
    cache_dir.mkdir(parents=True, exist_ok=True)
    if hasattr(yf, "set_tz_cache_location"):
        yf.set_tz_cache_location(str(cache_dir))
    return cache_dir


def safe_error(exc: BaseException, secrets: Iterable[str | None] = ()) -> str:
    """예외 메시지에서 API 키와 URL 쿼리의 인증값을 가린다."""
    message = f"{type(exc).__name__}: {exc}"
    for secret in secrets:
        if secret:
            message = message.replace(secret, "***")
    message = re.sub(
        r"(?i)(api[_-]?key|authkey|authorization)(=|%3D|/)([^&/\s]+)",
        r"\1\2***",
        message,
    )
    return message


def _temp_path(path: Path) -> Path:
    return path.with_name(f".{path.name}.tmp")


def atomic_write_json(path: Path, value: Any) -> None:
    """완성된 JSON만 원래 파일과 교체해 중간 실패 시 기존 결과를 보존한다."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = _temp_path(path)
    try:
        with temp.open("w", encoding="utf-8") as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp, path)
    finally:
        if temp.exists():
            temp.unlink()


def atomic_write_jsonl(path: Path, items: Iterable[dict]) -> None:
    """JSONL을 임시 파일에 모두 쓴 뒤 원래 파일과 교체한다."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = _temp_path(path)
    try:
        with temp.open("w", encoding="utf-8") as stream:
            for item in items:
                stream.write(json.dumps(item, ensure_ascii=False) + "\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp, path)
    finally:
        if temp.exists():
            temp.unlink()


def atomic_write_dataframe_csv(path: Path, frame: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = _temp_path(path)
    try:
        frame.to_csv(temp)
        os.replace(temp, path)
    finally:
        if temp.exists():
            temp.unlink()


def run_cli(main_function: Any) -> None:
    """예상 가능한 실행 오류는 짧게 표시하고 셸에 실패 상태를 전달한다."""
    try:
        main_function()
    except RuntimeError as exc:
        print(f"[오류] {exc}", file=sys.stderr)
        raise SystemExit(1)
