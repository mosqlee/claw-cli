#!/bin/bash
# setup_scene.sh - 从 Registry 拉取场景配置并一键安装
# 场景配置存储在 registry 的 scenes/ 目录下，动态拉取

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLAW_STORE="$HOME/.claw_store"
SCENE_CACHE="$CLAW_STORE/remote-scenes"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; }

# 读取 registry 配置
get_registry_url() {
    local config_file="$CLAW_STORE/config.json"
    if [ -f "$config_file" ]; then
        python3 -c "import json; c=json.load(open('$config_file')); print(c.get('registry', c.get('scenesRepo', '')))" 2>/dev/null
    fi
}

# 从 registry 拉取 scenes 目录
fetch_scenes() {
    local registry_url="$1"
    mkdir -p "$SCENE_CACHE"

    info "从 Registry 拉取场景配置..."
    local tmp_dir=$(mktemp -d)

    # sparse clone 只拉 scenes 目录
    if git clone --depth 1 --filter=blob:none --sparse "$registry_url" "$tmp_dir" 2>/dev/null; then
        cd "$tmp_dir"
        git sparse-checkout set scenes 2>/dev/null

        if [ -d "scenes" ]; then
            # 同步到本地缓存
            rm -rf "${SCENE_CACHE:?}/"*
            cp -r scenes/* "$SCENE_CACHE/" 2>/dev/null
            local count=$(find "$SCENE_CACHE" -name "*.json" -maxdepth 1 | wc -l | tr -d ' ')
            info "同步完成，发现 $count 个场景配置"
        else
            warn "Registry 中暂无 scenes 目录"
        fi
    else
        error "无法连接 Registry ($registry_url)，请检查网络或权限"
    fi

    rm -rf "$tmp_dir"
    cd - >/dev/null
}

# 列出可用场景
list_scenes() {
    local configs=()
    for f in "$SCENE_CACHE"/*.json; do
        [ -f "$f" ] && configs+=("$f")
    done

    if [ ${#configs[@]} -eq 0 ]; then
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
    for f in "${configs[@]}"; do
        local name=$(basename "$f" .json)
        local desc=$(python3 -c "import json; print(json.load(open('$f')).get('description',''))" 2>/dev/null || echo "")
        local skills=$(python3 -c "import json; d=json.load(open('$f')); print(', '.join(d.get('skills',[])))" 2>/dev/null || echo "")
        local agents=$(python3 -c "import json; d=json.load(open('$f')); print(', '.join(d.get('agents',[])))" 2>/dev/null || echo "")

        echo -e "  ${CYAN}$i)${NC} $name — $desc"
        [ -n "$skills" ] && echo -e "     Skills: $skills"
        [ -n "$agents" ] && echo -e "     Agents: $agents"
        i=$((i + 1))
    done
    echo "─────────────────────────────────────"
}

# 安装单个包
install_pkg() {
    local pkg="$1"
    if claw list 2>/dev/null | grep -q "$pkg"; then
        warn "  $pkg 已安装，跳过"
    else
        info "  安装 $pkg..."
        claw install "$pkg" 2>&1 | sed 's/^/  /'
        if [ $? -eq 0 ]; then
            info "  ✅ $pkg 安装成功"
        else
            error "  ❌ $pkg 安装失败"
        fi
    fi
}

# 安装场景
install_scene() {
    local config_file="$1"
    local name=$(basename "$config_file" .json)
    echo -e "\n${CYAN}🎬 Installing scene: $name${NC}"

    local skills=$(python3 -c "import json; print('\n'.join(json.load(open('$config_file')).get('skills',[])))" 2>/dev/null)
    local agents=$(python3 -c "import json; print('\n'.join(json.load(open('$config_file')).get('agents',[])))" 2>/dev/null)

    if [ -n "$skills" ]; then
        echo -e "\n📦 Skills:"
        while IFS= read -r pkg; do
            [ -n "$pkg" ] && install_pkg "$pkg"
        done <<< "$skills"
    fi

    if [ -n "$agents" ]; then
        echo -e "\n🤖 Agents:"
        while IFS= read -r pkg; do
            [ -n "$pkg" ] && install_pkg "$pkg"
        done <<< "$agents"
    fi

    # 处理 env 变量
    local env_vars=$(python3 -c "
import json
cfg = json.load(open('$config_file'))
env = cfg.get('env', {})
for k, v in env.items():
    print(f'{k}={v}')
" 2>/dev/null)

    if [ -n "$env_vars" ]; then
        echo -e "\n🔧 环境变量："
        while IFS='=' read -r k v; do
            [ -n "$k" ] && info "  $k=$v (请确认已配置)"
        done <<< "$env_vars"
    fi

    echo -e "\n${GREEN}✅ Scene '$name' 安装完成！${NC}"
    info "运行 'claw list' 查看已安装的包"
    info "运行 'claw verify' 校验完整性"
}

# ─── 主流程 ───

# 前置检查
command -v claw >/dev/null 2>&1 || {
    echo "claw-cli 未安装。"
    read -p "是否现在安装？(y/n) " ans
    [ "$ans" = "y" ] && bash "$SCRIPT_DIR/install_claw.sh" || exit 1
}

# 拉取场景
registry_url=$(get_registry_url)
if [ -z "$registry_url" ]; then
    error "未配置 Registry，请先执行: claw config set registry <git-repo-url>"
fi

fetch_scenes "$registry_url"

# 命令行直接指定场景
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
    read -p "选择要安装的角色套件编号 (r 刷新, q 退出): " choice

    [ "$choice" = "q" ] && exit 0
    [ "$choice" = "r" ] && { fetch_scenes "$registry_url"; continue; }

    local configs=()
    for f in "$SCENE_CACHE"/*.json; do
        [ -f "$f" ] && configs+=("$f")
    done

    idx=$((choice - 1))
    if [ "$idx" -ge 0 ] && [ "$idx" -lt "${#configs[@]}" ]; then
        install_scene "${configs[$idx]}"
    else
        warn "无效选择"
    fi
done
