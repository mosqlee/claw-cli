#!/bin/bash
# setup_scene.sh - 角色套件一键安装
# 用途：交互式选择角色，自动安装对应的 skill + agent 套件

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_DIR="$SCRIPT_DIR/scene_configs"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; }

# 前置检查
command -v claw >/dev/null 2>&1 || {
    echo "claw-cli 未安装。"
    read -p "是否现在安装？(y/n) " ans
    [ "$ans" = "y" ] && bash "$SCRIPT_DIR/install_claw.sh" || exit 1
}

# 列出可用场景
list_scenes() {
    echo -e "\n${CYAN}可用角色套件：${NC}"
    echo "─────────────────────────────────────"
    local i=1
    for f in "$CONFIG_DIR"/*.json; do
        [ -f "$f" ] || continue
        local name=$(basename "$f" .json)
        local desc=$(python3 -c "import json; print(json.load(open('$f')).get('description',''))" 2>/dev/null || echo "")
        local skills=$(python3 -c "import json; print(', '.join(json.load(open('$f')).get('skills',[])))" 2>/dev/null || echo "")
        local agents=$(python3 -c "import json; print(', '.join(json.load(open('$f')).get('agents',[])))" 2>/dev/null || echo "")
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
    echo -e "\n${CYAN}Installing scene: $name${NC}"

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

# 支持命令行参数直接指定场景
if [ -n "$1" ]; then
    config_file="$CONFIG_DIR/${1}.json"
    if [ -f "$config_file" ]; then
        install_scene "$config_file"
    else
        error "未找到场景配置: $1 (查找: $config_file)"
    fi
    exit 0
fi

# 交互式选择
while true; do
    list_scenes
    echo ""
    read -p "选择要安装的角色套件编号 (q 退出): " choice
    [ "$choice" = "q" ] && exit 0

    # 找到对应的配置文件
    local configs=()
    for f in "$CONFIG_DIR"/*.json; do
        [ -f "$f" ] && configs+=("$f")
    done

    idx=$((choice - 1))
    if [ "$idx" -ge 0 ] && [ "$idx" -lt "${#configs[@]}" ]; then
        install_scene "${configs[$idx]}"
    else
        warn "无效选择"
    fi
done
