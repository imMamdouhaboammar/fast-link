#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_NAME="fast-link"

echo "📦 Installing ${TARGET_NAME} for universal AI agent environments..."

SKILLS_ROOT="${AGENTS_SKILLS_DIR:-$HOME/.agents/skills}"
mkdir -p "${SKILLS_ROOT}"
rm -rf "${SKILLS_ROOT}/${TARGET_NAME}"
cp -r "${SCRIPT_DIR}" "${SKILLS_ROOT}/${TARGET_NAME}"
echo "  ✅ Installed to ${SKILLS_ROOT}/${TARGET_NAME}"

echo ""
echo "🎉 Installation complete!"
