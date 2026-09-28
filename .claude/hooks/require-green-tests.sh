#!/bin/bash
# Stop-хук: не даёт агенту завершить работу при красных тестах.
# Команда тестов берётся из .claude/test-command (одна строка). Пока файла нет — хук пропускает.
if ! command -v jq >/dev/null 2>&1; then
  echo "require-green-tests: нужен jq, проверка тестов пропущена" >&2
  exit 0
fi
INPUT=$(cat)
ACTIVE=$(echo "$INPUT" | jq -r '.stop_hook_active // false')
[ "$ACTIVE" = "true" ] && exit 0

ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
CMD_FILE="$ROOT/.claude/test-command"
[ -f "$CMD_FILE" ] || exit 0
CMD=$(head -n1 "$CMD_FILE")
[ -z "$CMD" ] && exit 0

OUT=$(cd "$ROOT" && bash -c "$CMD" 2>&1)
if [ $? -ne 0 ]; then
  TAIL=$(echo "$OUT" | tail -n 30)
  jq -n --arg r "Тесты красные. Доведи до зелёного или верни оркестратору причину, почему это невозможно в рамках задачи.
$TAIL" '{decision:"block", reason:$r}'
fi
exit 0
