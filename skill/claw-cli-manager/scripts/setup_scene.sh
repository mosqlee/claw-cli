#!/bin/bash
# setup_scene.sh - 从 Registry 拉取场景配置并一键安装
# 兼容 bash 3.2+ (macOS), 使用 jq 解析 JSON

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLAW_STORE="$HOME/.claw_store"
SCENE_CACHE="$CLAW_STORE/remote-scenes"
CONFIG_FILE="$CLAW_STORE/config.json"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; }

get_registry_url() {
    if [ -f "$CONFIG_FILE" ] && command -v jq >/dev/null 2>&1; then
        jq -r '.registry // .scenesRepo // empty' "$CONFIG_FILE" 2>/dev/null
    fi
}

fetch_scenes() {
    local registry_url="$1"
    mkdir -p "$SCENE_CACHE"

    info "从 Registry 拉取场景配置..."
    local tmp_dir=$(mktemp -d)

    if git clone --depth 1 --filter=blob:none --sparse "$registry_url" "$tmp_dir/claw-registry" 2>/dev/null; then
        (cd "$tmp_dir/claw-registry" && git sparse-checkout set scenes 2>/dev/null) || true

        if [ -d "$tmp_dir/claw-registry/scenes" ]; then
            rm -rf "${SCENE_CACHE:?}/"*
            cp -r "$tmp_dir/claw-registry/scenes/"* "$SCENE_CACHE/" 2>/dev/null || true
            local count=$(find "$SCENE_CACHE" -name "*.json" -maxdepth 1 2>/dev/null | wc -l | tr -d ' ')
            info "同步完成，发现 $count 个场景配置"
        else
            warn "Registry 中暂无 scenes 目录"
        fi
    else
        rm -rf "$tmp_dir"
        error "无法连接 Registry ($registry_url)，请检查网络或权限"
    fi

    rm -rf "$tmp_dir"
}

list_scenes() {
    local configs=""
    for f in "$SCENE_CACHE"/*.json; do
        [ -f "$f" ] && configs="$configs $(basename "$f" .json)"
    done
    configs=$(echo "$configs" | xargs)

    if [ -z "$configs" ]; then
        warn "暂无可用场景配置"
        echo ""
        echo "你可以："
        echo "  1. 在 Registry 的 scenes/ 目录添加场景 JSON"
        echo "  2. 使用 claw scene init <name> 创建本地场景"
        return 1
    fi

    echo -e "\n${CYAN}可用角色套件：${NC}"
    echo "─────────────────────────────────────"
    local i=1
    for name in $configs; do
        local desc=$(jq -r '.description // empty' "$SCENE_CACHE/${name}.json" 2>/dev/null || echo "")
        local skills=$(jq -r '.skills // [] | join(", ")' "$SCENE_CACHE/${name}.json" 2>/dev/null || echo "")
        local agents=$(jq -r '.agents // [] | join(", ")' "$SCENE_CACHE/${name}.json" 2>/dev/null || echo "")

        echo -e "  ${CYAN}$i)${NC} $name — $desc"
        [ -n "$skills" ] && echo -e "     Skills: $skills"
        [ -n "$agents" ] && echo -e "     Agents: $agents"
        i=$((i + 1))
    done
    echo "─────────────────────────────────────"
}

install_pkg() {
    local pkg="$1"
    if claw list 2>/dev/null | grep -q "$pkg"; then
        warn "  $pkg 已安装，跳过"
    else
        info "  安装 $pkg..."
        claw install "$pkg" 2>&1 | sed 's/^/  /' || warn "  ❌ $pkg 安装失败"
    fi
}

install_scene() {
    local config_file="$1"
    local name=$(basename "$config_file" .json)
    echo -e "\n${CYAN}🎬 Installing scene: $name${NC}"

    local skills=$(jq -r '.skills // [] | join("\n")' "$config_file" 2>/dev/null || echo "")
    local agents=$(jq -r '.agents // [] | join("\n")' "$config_file" 2>/dev/null || echo "")

    if [ -n "$skills" ]; then
        echo -e "\n📦 Skills:"
        echo "$skills" | while read -r pkg; do
            [ -n "$pkg" ] && install_pkg "$pkg"
        done
    fi

    if [ -n "$agents" ]; then
        echo -e "\n🤖 Agents:"
        echo "$agents" | while read -r pkg; do
            [ -n "$pkg" ] && install_pkg "$pkg"
        done
    fi

    # 处理 env 变量
    local env_vars=$(jq -r '.env // {} | to_entries[] | "\(.key)=\(.value)"' "$config_file" 2>/dev/null || echo "")
    if [ -n "$env_vars" ]; then
        echo -e "\n🔧 环境变量："
        echo "$env_vars" | while read -r line; do
            [ -n "$line" ] && info "  $line (请确认已配置)"
        done
    fi

    echo -e "\n${GREEN}✅ Scene '$name' 安装完成！${NC}"
    info "运行 'claw list' 查看已安装的包"
    info "运行 'claw verify' 校验完整性"
}

# ─── 主流程 ───

command -v claw >/dev/null 2>&1 || {
    echo "claw-cli 未安装。"
    local ans
    read -rp "是否现在安装？(y/n) " ans
    [ "$ans" = "y" ] && bash "$SCRIPT_DIR/install_claw.sh" || exit 1
}

registry_url=$(get_registry_url)
if [ -z "$registry_url" ]; then
    error "未配置 Registry，请先执行: claw config set registry <git-repo-url>"
fi

fetch_scenes "$registry_url"

# 直接指定场景
if [ -n "$1" ]; then
    config_file="$SCENE_CACHE/${1}.json"
    if [ -f "$config_file" ]; then
        install_scene "$config_file"
    else
        error "未找到场景: $1"
    fi
    exit 0
fi

# 交互式选择
while true; do
    list_scenes || exit 0
    echo ""
    local choice
    read -rp "选择要安装的角色套件编号 (r 刷新, q 退出): " choice

    [ "$choice" = "q" ] && exit 0
    [ "$choice" = "r" ] && { fetch_scenes "$registry_url"; continue; }

    local configs=""
    for f in "$SCENE_CACHE"/*.json; do
        [ -f "$f" ] && configs="$configs $(basename "$f" .json)"
    done
    configs=$(echo "$configs" | xargs)

    local found=""
    local idx=0
    for name in $configs; do
        idx=$((idx + 1))
        if [ "$idx" = "$choice" ]; then
            found="$name"
            break
        fi
    done

    if [ -n "$found" ]; then
        install_scene "$SCENE_CACHE/${found}.json"
    else
        warn "无效选择"
    fi
done
