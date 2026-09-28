#!/bin/bash
# PreToolUse guard: разрешает Write/Edit/NotebookEdit только в перечисленных префиксах путей.
# Использование в frontmatter агента: guard-paths.sh src/server/ src/domain/
# Без аргументов разрешена только память агентов (.claude/agent-memory*).
# Bash этим хуком не покрывается — запись через shell ловит reviewer по git status.
if ! command -v jq >/dev/null 2>&1; then
  echo "Заблокировано: для проверки путей нужен jq. Установи jq." >&2
  exit 2
fi
set -f  # пути не раскрываются как glob
INPUT=$(cat)
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty')
[ -z "$FILE" ] && exit 0

# Нормализация пути без realpath -m (его нет в macOS): раскрывает . и ..,
# так что обход через src/server/../../docs не пройдёт.
normalize() {
  local IFS=/ part out=()
  for part in $1; do
    case "$part" in
      ''|.) ;;
      ..) [ ${#out[@]} -gt 0 ] && unset 'out[${#out[@]}-1]' ;;
      *) out+=("$part") ;;
    esac
  done
  echo "/${out[*]}"
}

ROOT=$(normalize "${CLAUDE_PROJECT_DIR:-$(pwd)}")
case "$FILE" in /*) ABS="$FILE" ;; *) ABS="$ROOT/$FILE" ;; esac
ABS=$(normalize "$ABS")
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

echo "Заблокировано: запись в '$REL' вне разрешённых путей (${*:-только память агента}). Если задача требует этого файла — верни вопрос оркестратору." >&2
exit 2
