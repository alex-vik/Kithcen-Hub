#!/bin/bash
# PreToolUse guard: разрешает Write/Edit только в перечисленных префиксах путей.
# Использование в frontmatter агента: guard-paths.sh src/server/ src/domain/
if ! command -v jq >/dev/null 2>&1; then
  echo "Заблокировано: для проверки путей нужен jq. Установи jq." >&2
  exit 2
fi
INPUT=$(cat)
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty')
[ -z "$FILE" ] && exit 0

ROOT=$(realpath -m "${CLAUDE_PROJECT_DIR:-$(pwd)}")
case "$FILE" in /*) ABS="$FILE" ;; *) ABS="$ROOT/$FILE" ;; esac
ABS=$(realpath -m "$ABS")   # раскрывает ../ — обход через src/server/../../docs не пройдёт
REL="${ABS#$ROOT/}"
[ "$REL" = "$ABS" ] && { echo "Заблокировано: запись вне проекта ($FILE)" >&2; exit 2; }

# Память агентов разрешена всегда
case "$REL" in
  .claude/agent-memory/*|.claude/agent-memory-local/*) exit 0 ;;
esac

for PREFIX in "$@"; do
  case "$REL" in
    "$PREFIX"*) exit 0 ;;
  esac
done

echo "Заблокировано: запись в '$REL' вне разрешённых путей ($*). Если задача требует этого файла — верни вопрос оркестратору." >&2
exit 2
