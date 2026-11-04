#!/bin/sh
set -eu

if [ -z "${ECHOTALK_E2E_WEBKIT_EXECUTABLE:-}" ] ||
  [ ! -f "$ECHOTALK_E2E_WEBKIT_EXECUTABLE" ] ||
  [ ! -x "$ECHOTALK_E2E_WEBKIT_EXECUTABLE" ]; then
  printf '%s\n' "WebKit SDK executable is missing or is not executable." >&2
  exit 1
fi

# 保留 SDK 默认参数；在 Playwright 参数校验之后追加进程级 Cocoa 偏好。
exec "$ECHOTALK_E2E_WEBKIT_EXECUTABLE" "$@" -NSAutomaticWindowAnimationsEnabled NO
