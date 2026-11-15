"""SGEC 严格离线校验与合成评测（SGEC-OFF）纯模块。

只做严格结构校验、不可变结构与白名单序列化；不导入 ORM、application config、数据库或
环境变量，不读时钟、不写文件、不访问网络。fixture 文件读取由
``scripts/evaluate_sgec_offline.py`` 的 runner 负责，本模块不提供任何文件读取入口。
"""

from collections.abc import Collection
from dataclasses import dataclass
from typing import Any, Literal

SGECIssueCode = Literal[
    "not_implemented",
    "invalid_top_level",
    "missing_required_field",
    "invalid_field_type",
    "unknown_skill_tag",
    "invalid_confidence",
    "unknown_field",
    "invalid_allowed_tags",
]

_OFFLINE_SOURCE = "offline_synthetic"
_UNKNOWN_FIELD = "<unknown>"
_ROOT_PATH = "<root>"

_CORE_STRING_FIELDS = ("skill_tag", "original", "corrected", "error_type")
_ALLOWED_FIELDS = frozenset((*_CORE_STRING_FIELDS, "confidence"))


@dataclass(frozen=True)
class SGECIssue:
    """一条稳定、机器可读的校验问题；不回显原始业务文本或未知字段名。"""

    path: str
    field: str
    code: SGECIssueCode

    def to_dict(self) -> dict[str, str]:
        return {"path": self.path, "field": self.field, "code": self.code}


@dataclass(frozen=True)
class SGECAcceptedItem:
    """一条受控重构后的 accepted 项；受控元数据固定，不从输入接收。"""

    skill_tag: str
    original: str
    corrected: str
    error_type: str
    confidence: int | float | None
    source: str = _OFFLINE_SOURCE
    provider: str | None = None
    model_version: str | None = None
    is_synthetic: bool = True

    def to_dict(self) -> dict[str, Any]:
        return {
            "skill_tag": self.skill_tag,
            "original": self.original,
            "corrected": self.corrected,
            "error_type": self.error_type,
            "confidence": self.confidence,
            "source": self.source,
            "provider": self.provider,
            "model_version": self.model_version,
            "is_synthetic": self.is_synthetic,
        }


@dataclass(frozen=True)
class SGECBatchResult:
    """不可变批次结果。"""

    ok: bool
    accepted: tuple[SGECAcceptedItem, ...]
    issues: tuple[SGECIssue, ...]

    def to_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "accepted": [item.to_dict() for item in self.accepted],
            "issues": [issue.to_dict() for issue in self.issues],
        }


@dataclass(frozen=True)
class SGECOfflineSummary:
    """离线 runner 的结构接受/拒绝与期望匹配汇总，不称准确率。"""

    ok: bool
    total: int
    accepted: int
    rejected: int
    matched: int
    mismatched: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "total": self.total,
            "accepted": self.accepted,
            "rejected": self.rejected,
            "matched": self.matched,
            "mismatched": self.mismatched,
        }


def _normalize_allowed_skill_tags(
    allowed_skill_tags: Collection[str],
) -> frozenset[str] | None:
    """把调用方合法集合/序列归一为不可变集合；非法（str/bytes/bytearray、一次性 iterator/generator、非 Collection、非字符串元素）返回 None。"""
    if isinstance(allowed_skill_tags, (str, bytes, bytearray)):
        return None
    if not isinstance(allowed_skill_tags, Collection):
        return None
    try:
        tags = frozenset(allowed_skill_tags)
    except TypeError:
        return None
    if not all(isinstance(tag, str) for tag in tags):
        return None
    return tags


def _is_valid_confidence(value: object) -> bool:
    """confidence 仅接受有限、非布尔、0<=x<=1 的数字；避免大整数 OverflowError。"""
    if isinstance(value, bool):
        return False
    if not isinstance(value, (int, float)):
        return False
    if value != value:  # NaN
        return False
    try:
        return 0.0 <= value <= 1.0
    except (OverflowError, TypeError):
        return False


def _issue(path: str, field: str, code: SGECIssueCode) -> SGECIssue:
    return SGECIssue(path=path, field=field, code=code)


def validate_sgec_batch(
    raw_json_value: Any,
    allowed_skill_tags: Collection[str],
) -> SGECBatchResult:
    """严格校验一个批次；合法则返回受控重构项，任一坏值整批零接受。"""
    allowed = _normalize_allowed_skill_tags(allowed_skill_tags)
    if allowed is None:
        return SGECBatchResult(
            ok=False,
            accepted=(),
            issues=(_issue(_ROOT_PATH, "allowed_skill_tags", "invalid_allowed_tags"),),
        )

    if not isinstance(raw_json_value, dict):
        return SGECBatchResult(
            ok=False,
            accepted=(),
            issues=(_issue(_ROOT_PATH, _ROOT_PATH, "invalid_top_level"),),
        )

    extra_top_keys = [key for key in raw_json_value if key != "errors"]
    if extra_top_keys:
        return SGECBatchResult(
            ok=False,
            accepted=(),
            issues=(_issue(_ROOT_PATH, _UNKNOWN_FIELD, "unknown_field"),),
        )

    if "errors" not in raw_json_value:
        return SGECBatchResult(
            ok=False,
            accepted=(),
            issues=(_issue(_ROOT_PATH, "errors", "invalid_top_level"),),
        )

    errors_value = raw_json_value["errors"]
    if not isinstance(errors_value, list):
        return SGECBatchResult(
            ok=False,
            accepted=(),
            issues=(_issue(_ROOT_PATH, "errors", "invalid_top_level"),),
        )

    issues: list[SGECIssue] = []
    accepted: list[SGECAcceptedItem] = []

    for index, item in enumerate(errors_value):
        record_path = f"errors[{index}]"
        if not isinstance(item, dict):
            issues.append(_issue(record_path, _ROOT_PATH, "invalid_field_type"))
            continue

        extra_keys = [key for key in item if key not in _ALLOWED_FIELDS]
        if extra_keys:
            issues.append(_issue(record_path, _UNKNOWN_FIELD, "unknown_field"))
            continue

        record_ok = True

        skill_tag = item.get("skill_tag")
        if "skill_tag" not in item or skill_tag is None:
            issues.append(_issue(record_path, "skill_tag", "missing_required_field"))
            record_ok = False
        elif not isinstance(skill_tag, str):
            issues.append(_issue(record_path, "skill_tag", "invalid_field_type"))
            record_ok = False
        elif skill_tag not in allowed:
            issues.append(_issue(record_path, "skill_tag", "unknown_skill_tag"))
            record_ok = False

        for field_name in ("original", "corrected", "error_type"):
            value = item.get(field_name)
            if field_name not in item or value is None:
                issues.append(_issue(record_path, field_name, "missing_required_field"))
                record_ok = False
            elif not isinstance(value, str):
                issues.append(_issue(record_path, field_name, "invalid_field_type"))
                record_ok = False

        if "confidence" in item and item["confidence"] is not None:
            if not _is_valid_confidence(item["confidence"]):
                issues.append(_issue(record_path, "confidence", "invalid_confidence"))
                record_ok = False

        if not record_ok:
            continue

        accepted.append(
            SGECAcceptedItem(
                skill_tag=item["skill_tag"],
                original=item["original"],
                corrected=item["corrected"],
                error_type=item["error_type"],
                confidence=item.get("confidence"),
            )
        )

    if issues:
        return SGECBatchResult(ok=False, accepted=(), issues=tuple(issues))

    return SGECBatchResult(ok=True, accepted=tuple(accepted), issues=())
