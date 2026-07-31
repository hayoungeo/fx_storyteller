# -*- coding: utf-8 -*-
"""환율 뉴스 프로젝트의 단계별 통합 실행 진입점."""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

from pipeline_utils import BASE_DIR


PYTHON_STAGES = {
    "collect_news": "collect_news_newsapi.py",
    "extract_news": "extract_events_groq_hybrid.py",
    "download_fx": "download_fx_prices.py",
    "weights": "compute_impact_weights_sv.py",
    "collect_macro": "collect_macro_data.py",
    "process_macro": "compute_macro_indicators.py",
    "prepare_vrp": "prepare_vrp_data.py",
    "analyze_vrp": "analyze_vrp.py",
    "live_rates": "Fetch_live_fx_rates.py",
    "personalized": "generate_personalized_summary.py",
}

MODE_STAGES = {
    "news": ["collect_news", "extract_news"],
    "volatility": ["download_fx", "estimate_sv", "weights", "prepare_vrp", "analyze_vrp"],
    "macro": ["collect_macro", "process_macro"],
    "vrp": ["prepare_vrp", "analyze_vrp"],
    "personalized": ["personalized"],
    "all": [
        "collect_news", "extract_news",
        "download_fx", "estimate_sv", "weights",
        "collect_macro", "process_macro",
        "prepare_vrp", "analyze_vrp",
        "personalized",
    ],
}


def find_rscript() -> str:
    found = shutil.which("Rscript")
    if found:
        return found
    candidates = sorted(Path("C:/Program Files/R").glob("R-*/bin/Rscript.exe"), reverse=True)
    if candidates:
        return str(candidates[0])
    raise RuntimeError("Rscript를 찾지 못했습니다. R을 설치하고 PATH에 추가하세요.")


def run_command(label: str, command: list[str], input_text: str | None = None) -> None:
    print(f"\n{'=' * 12} {label} {'=' * 12}", flush=True)
    completed = subprocess.run(
        command,
        cwd=BASE_DIR,
        input=input_text,
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError(f"{label} 단계가 종료 코드 {completed.returncode}로 실패했습니다.")


def run_stage(stage: str) -> None:
    if stage == "estimate_sv":
        run_command(stage, [find_rscript(), str(BASE_DIR / "estimate_sv_volatility.R")])
        return
    run_command(stage, [sys.executable, str(BASE_DIR / PYTHON_STAGES[stage])])


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="환율 뉴스 파이프라인 통합 실행")
    parser.add_argument(
        "--mode",
        choices=[*MODE_STAGES, "goal", "app"],
        default="all",
        help="실행할 묶음(기본: all)",
    )
    parser.add_argument("--goal", help='goal 모드의 목적. 예: "일본 여행"')
    parser.add_argument(
        "--refresh-live-rates",
        action="store_true",
        help="요약 전에 수출입은행의 최신 환율로 자산 정보를 갱신",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    if args.mode == "app":
        streamlit = shutil.which("streamlit")
        if not streamlit:
            raise RuntimeError("streamlit이 없습니다. pip install -r requirements.txt를 실행하세요.")
        run_command("streamlit app", [streamlit, "run", str(BASE_DIR / "main_demo.py")])
        return

    if args.mode == "goal":
        if not args.goal:
            raise RuntimeError('goal 모드에는 --goal "일본 여행"처럼 목적을 지정하세요.')
        run_command(
            "goal summary",
            [sys.executable, str(BASE_DIR / "goal_news_summary.py")],
            input_text=args.goal + "\n",
        )
        return

    stages = list(MODE_STAGES[args.mode])
    if args.refresh_live_rates:
        insertion = stages.index("personalized") if "personalized" in stages else len(stages)
        stages.insert(insertion, "live_rates")

    for stage in stages:
        run_stage(stage)

    print("\n선택한 파이프라인이 모두 완료되었습니다.")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, FileNotFoundError) as exc:
        print(f"\n[중단] {exc}", file=sys.stderr)
        raise SystemExit(1)
