#!/bin/bash
# install_claw.sh - 一键安装 claw-cli
# 用途：当 npm install -g 不可用时的备选安装方式

set -e

CLAW_VERSION="1.0.0"
INSTALL_DIR="$HOME/.claw-cli"
BIN_DIR="$HOME/.local/bin"
REPO_URL="https://github.com/mosqlee/claw-cli.git"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# Step 1: 环境检测
info "检查运行环境..."

command -v node >/dev/null 2>&1 || error "需要 Node.js >= 18，请先安装: https://nodejs.org/"
NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
[ "$NODE_VERSION" -lt 18 ] && error "Node.js 版本过低 (当前: $(node -v), 需要: >= 18)"

command -v git >/dev/null 2>&1 || error "需要 Git，请先安装"
command -v npm >/dev/null 2>&1 || error "需要 npm"

info "Node.js: $(node -v) ✅"
info "Git: $(git --version) ✅"
info "npm: $(npm -v) ✅"

# Step 2: 尝试 npm 全局安装（优先）
info "尝试 npm 全局安装..."
if npm install -g openclaw-claw 2>/dev/null; then
    command -v claw >/dev/null 2>&1 && {
        info "✅ claw-cli 安装成功！"
        claw --version
        info "运行 'claw doctor' 检查环境"
        exit 0
    }
    warn "npm 安装成功但 claw 命令不可用，尝试从源码安装..."
else
    warn "npm 全局安装失败，从源码安装..."
fi

# Step 3: 从源码安装（备选）
info "从源码安装 claw-cli..."

if [ -d "$INSTALL_DIR" ]; then
    info "更新现有安装..."
    cd "$INSTALL_DIR"
    git pull --ff-only 2>/dev/null || warn "Git pull 失败，使用现有版本"
else
    info "克隆源码到 $INSTALL_DIR..."
    git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
fi

npm install --production
npm run build

# Step 4: 创建符号链接
mkdir -p "$BIN_DIR"
ln -sf "$INSTALL_DIR/dist/cli.js" "$BIN_DIR/claw"

# Step 5: 加入 PATH
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
    echo '' >> "$HOME/.zshrc"
    echo '# claw-cli' >> "$HOME/.zshrc"
    echo "export PATH=\"\$PATH:$BIN_DIR\"" >> "$HOME/.zshrc"
    export PATH="$PATH:$BIN_DIR"
    info "已将 $BIN_DIR 加入 PATH（需要重新打开终端或执行 source ~/.zshrc）"
fi

# Step 6: 验证
if command -v claw >/dev/null 2>&1; then
    info "✅ claw-cli 安装成功！"
    claw --version
    echo ""
    info "下一步："
    info "  1. 运行 'claw doctor' 检查环境"
    info "  2. 运行 'claw config set registry <git-repo-url>' 配置私有仓库"
else
    error "安装完成但 claw 命令不可用，请手动执行: export PATH=\"\$PATH:$BIN_DIR\""
fi
