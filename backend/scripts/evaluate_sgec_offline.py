"""SGEC 严格离线合成评测 CLI runner。

从 backend 目录以 ``python -m scripts.evaluate_sgec_offline`` 运行；只读取固定合成
fixtures，调用纯校验模块汇总结构接受/拒绝与期望匹配，不输出准确率或教学质量结论。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

from services.sgec_offline import SGECOfflineSummary, validate_sgec_batch

DEFAULT_FIXTURE_PATH = "tests/fixtures/sgec_offline_cases.json"


class SGECFixtureError(Exception):
    """固定合成 fixtures 不可读、非法 JSON 或形状错误（安全固定诊断）。"""


def _reject_nonstandard_constant(value: str) -> Any:
    raise json.JSONDecodeError(f"non-standard JSON constant: {value}", value, 0)


def _is_valid_allowed_tags(value: Any) -> bool:
    return isinstance(value, list) and all(isinstance(tag, str) for tag in value)


def _load_cases(fixture_path: str) -> list[dict[str, Any]]:
    path = Path(fixture_path)
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise SGECFixtureError("fixture: unreadable") from exc
    except UnicodeDecodeError as exc:
        raise SGECFixtureError("fixture: invalid utf8") from exc

    try:
        payload = json.loads(text, parse_constant=_reject_nonstandard_constant)
    except ValueError as exc:
        # json.JSONDecodeError 是 ValueError 子类；此处在保留 Python int 位数限制的
        # 前提下，把超长整数字面量的解码 ValueError 一并映射为固定安全「invalid json」
        # 诊断（exit2，无原始 traceback），不增大 sys.int_max_str_digits、不接收/截断/修补输入。
        raise SGECFixtureError("fixture: invalid json") from exc

    if not isinstance(payload, dict) or not isinstance(payload.get("cases"), list):
        raise SGECFixtureError("fixture: bad shape")

    cases = payload["cases"]
    for case in cases:
        if not isinstance(case, dict):
            raise SGECFixtureError("fixture: bad shape")
        if not {"allowed_skill_tags", "payload", "expect_accept"} <= set(case):
            raise SGECFixtureError("fixture: bad shape")
        if not isinstance(case["expect_accept"], bool):
            raise SGECFixtureError("fixture: bad expect_accept")
        if not _is_valid_allowed_tags(case["allowed_skill_tags"]):
            raise SGECFixtureError("fixture: bad allowed_skill_tags")

    return cases


def run_offline(fixture_path: str) -> SGECOfflineSummary:
    """读取固定 fixtures 并汇总结构接受/拒绝与期望匹配。"""
    cases = _load_cases(fixture_path)

    accepted = 0
    rejected = 0
    matched = 0
    mismatched = 0

    for case in cases:
        allowed_skill_tags = case["allowed_skill_tags"]
        expect_accept = case["expect_accept"]
        result = validate_sgec_batch(case["payload"], allowed_skill_tags)

        if result.ok:
            accepted += 1
        else:
            rejected += 1

        if result.ok == expect_accept:
            matched += 1
        else:
            mismatched += 1

    return SGECOfflineSummary(
        ok=(mismatched == 0),
        total=len(cases),
        accepted=accepted,
        rejected=rejected,
        matched=matched,
        mismatched=mismatched,
    )


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    fixture_path = args[0] if args else DEFAULT_FIXTURE_PATH

    try:
        summary = run_offline(fixture_path)
    except SGECFixtureError as exc:
        print(f"[sgec_offline] {exc}", file=sys.stderr)
        return 2

    print(
        "[sgec_offline] "
        f"total={summary.total} accepted={summary.accepted} "
        f"rejected={summary.rejected} matched={summary.matched} "
        f"mismatched={summary.mismatched}"
    )
    return 0 if summary.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
