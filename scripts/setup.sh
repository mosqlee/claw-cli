#!/bin/bash
# setup.sh - claw-cli 交互式初始化安装脚本
# 兼容 bash 3.2+ (macOS), 使用 jq 解析 JSON

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }
header() { echo -e "\n${BOLD}${CYAN}━━━ $1 ━━━${NC}"; }

# 获取用户输入
ask() {
    local desc="$1" default_val="$2"
    if [ -n "$default_val" ]; then
        printf "\n${CYAN}%s${NC} [${DIM}%s${DIM}]: " "$desc" "$default_val" >&2
    else
        printf "\n${CYAN}%s${NC}: " "$desc" >&2
    fi
    local ans
    read -r ans </dev/tty
    echo "${ans:-$default_val}"
}

# 用 jq 读取 JSON（安全）
json_get() {
    local file="$1" key="$2"
    jq -r ".$key // empty" "$file" 2>/dev/null
}

json_get_arr() {
    local file="$1" key="$2"
    jq -r ".$key // [] | join(\" \")" "$file" 2>/dev/null
}

json_set() {
    local file="$1" key="$2" value="$3"
    local tmp=$(mktemp)
    jq --arg k "$key" --arg v "$value" '.$k = $v' "$file" > "$tmp" 2>/dev/null && mv "$tmp" "$file"
}

# 校验 URL（仅允许 git@ 和 https://）
validate_git_url() {
    local url="$1"
    echo "$url" | grep -qE '^(git@|https://)' || { warn "无效的 Git URL: $url"; return 1; }
    return 0
}

CLAW_STORE="$HOME/.claw_store"
REGISTRY_CACHE="$CLAW_STORE/registry"
CONFIG_FILE="$CLAW_STORE/config.json"

# ═══════════════════════════════════════
# Step 1: 环境检查
# ═══════════════════════════════════════
check_environment() {
    header "Step 1/6: 环境检查"

    if command -v node >/dev/null 2>&1; then
        NODE_VERSION=$(node -v)
        NODE_MAJOR=$(echo "$NODE_VERSION" | sed 's/v//' | cut -d. -f1)
        if [ "$NODE_MAJOR" -lt 18 ]; then
            error "Node.js 版本过低 ($NODE_VERSION)，需要 >= 18"
        fi
        info "Node.js $NODE_VERSION ✅"
    else
        error "Node.js 未安装，请先安装: https://nodejs.org/"
    fi

    if command -v npm >/dev/null 2>&1; then
        info "npm $(npm -v) ✅"
    else
        error "npm 未安装"
    fi

    if command -v git >/dev/null 2>&1; then
        info "Git $(git --version | sed 's/.* //') ✅"
    else
        error "Git 未安装"
    fi

    # jq
    if ! command -v jq >/dev/null 2>&1; then
        info "jq 未安装，正在自动安装..."
        if command -v brew >/dev/null 2>&1; then
            brew install jq 2>&1 || warn "brew install jq 失败，请手动安装"
        elif command -v apt-get >/dev/null 2>&1; then
            sudo apt-get install -y jq 2>&1 || warn "apt-get install jq 失败，请手动安装"
        elif command -v yum >/dev/null 2>&1; then
            sudo yum install -y jq 2>&1 || warn "yum install jq 失败，请手动安装"
        else
            warn "无法自动安装 jq，请手动安装后重试"
            exit 1
        fi
    fi
    info "jq $(jq --version 2>/dev/null) ✅"

    # OpenClaw
    OPENCLAW_DIR=""
    if command -v openclaw >/dev/null 2>&1; then
        OPENCLAW_DIR=$(which openclaw 2>/dev/null)
        info "OpenClaw $OPENCLAW_DIR ✅"
    elif [ -d "$HOME/.openclaw" ]; then
        OPENCLAW_DIR="$HOME/.openclaw"
        info "OpenClaw 目录: $OPENCLAW_DIR ✅"
    else
        warn "未检测到 OpenClaw 安装（不影响 claw-cli 使用）"
        OPENCLAW_DIR=$(ask "请输入 OpenClaw 安装目录（可选，留空跳过）" "")
    fi

    # Skills 目录
    if [ -n "$OPENCLAW_DIR" ] && [ -d "$OPENCLAW_DIR/workspace/skills" ]; then
        SKILLS_DIR="$OPENCLAW_DIR/workspace/skills"
        info "Skills 目录: $SKILLS_DIR ✅"
    else
        SKILLS_DIR=$(ask "请输入 Skills 安装目录" "$HOME/.openclaw/workspace/skills")
    fi

    # 检测当前 shell
    CURRENT_SHELL=""
    [ -n "$ZSH_VERSION" ] && CURRENT_SHELL="zsh"
    [ -n "$BASH_VERSION" ] && CURRENT_SHELL="bash"
    [ -z "$CURRENT_SHELL" ] && CURRENT_SHELL=$(basename "$SHELL" 2>/dev/null || echo "unknown")
    info "当前 Shell: $CURRENT_SHELL"
}

# ═══════════════════════════════════════
# Step 2: 安装 claw-cli
# ═══════════════════════════════════════
install_claw_cli() {
    header "Step 2/6: 安装 claw-cli"

    if command -v claw >/dev/null 2>&1; then
        info "claw-cli 已安装"
        local reinstall=$(ask "重新安装？(y/n)" "n")
        [ "$reinstall" != "y" ] && return
    fi

    info "正在安装 openclaw-claw..."

    # 修复 npm 缓存目录权限（之前 sudo npm 可能留下 root 文件）
    local npm_cache="$HOME/.npm"
    if [ -d "$npm_cache" ] && [ "$(stat -f '%u' "$npm_cache" 2>/dev/null)" != "$(id -u)" ]; then
        warn "检测到 npm 缓存目录有权限问题，正在修复..."
        sudo chown -R "$(id -u):$(id -g)" "$npm_cache" 2>/dev/null || true
    fi

    # 尝试直接安装
    if npm install -g openclaw-claw 2>&1; then
        hash -r 2>/dev/null || true
        if command -v claw >/dev/null 2>&1; then
            info "✅ claw-cli 安装成功！"
            return
        fi
        # npm install 成功但 claw 不在 PATH，手动定位
        local npm_bin="$(npm bin -g 2>/dev/null || npm prefix -g 2>/dev/null)/bin"
        if [ -x "$npm_bin/claw" ]; then
            export PATH="$npm_bin:$PATH"
            info "✅ claw-cli 安装成功！（已将 $npm_bin 加入 PATH）"
            return
        fi
    fi

    # 权限不足时，配置用户级全局目录（不需要 sudo）
    local npm_global="$(npm prefix -g 2>/dev/null)"
    if [ ! -w "$npm_global" ]; then
        warn "npm 全局目录 ($npm_global) 无写权限"
        info "配置用户级 npm 全局目录..."
        mkdir -p "$HOME/.npm-global"
        npm config set prefix "$HOME/.npm-global"
        export PATH="$HOME/.npm-global/bin:$PATH"

        # 持久化 PATH
        case "$CURRENT_SHELL" in
            zsh) [ -f "$HOME/.zshrc" ] && echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> "$HOME/.zshrc" ;;
            bash) [ -f "$HOME/.bashrc" ] && echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> "$HOME/.bashrc" ;;
            fish) mkdir -p "$HOME/.config/fish"; [ -f "$HOME/.config/fish/config.fish" ] && echo 'set -gx PATH $HOME/.npm-global/bin $PATH' >> "$HOME/.config/fish/config.fish" ;;
        esac

        if npm install -g openclaw-claw 2>&1; then
            hash -r 2>/dev/null || true
            if command -v claw >/dev/null 2>&1; then
                info "✅ claw-cli 安装成功！（已配置用户级全局目录 ~/.npm-global）"
                return
            fi
            export PATH="$HOME/.npm-global/bin:$PATH"
            if command -v claw >/dev/null 2>&1; then
                info "✅ claw-cli 安装成功！（已配置用户级全局目录 ~/.npm-global）"
                return
            fi
        fi
    fi

    # 配置 ~/.npm-global 后仍然失败，走源码安装
    warn "npm 安装失败，尝试从源码安装..."
    local tmp_dir=$(mktemp -d)
    git clone --depth 1 https://github.com/mosqlee/claw-cli.git "$tmp_dir/claw-cli" 2>&1 || {
        rm -rf "$tmp_dir"
        error "源码克隆失败，请检查网络"
    }
    (cd "$tmp_dir/claw-cli" && npm install --production 2>&1 && npx tsc 2>&1) || {
        rm -rf "$tmp_dir"
        error "源码构建失败"
    }

    local bin_dir="$HOME/.local/bin"
    mkdir -p "$bin_dir"
    ln -sf "$tmp_dir/claw-cli/dist/cli.js" "$bin_dir/claw"
    chmod +x "$bin_dir/claw"
    add_to_path "$bin_dir"
    export PATH="$PATH:$bin_dir"
    info "✅ 从源码安装成功 (claw → $bin_dir/claw)"
    rm -rf "$tmp_dir"

    warn "npm 安装失败，尝试从源码安装..."
    local tmp_dir=$(mktemp -d)
    git clone --depth 1 https://github.com/mosqlee/claw-cli.git "$tmp_dir/claw-cli" 2>&1 || {
        rm -rf "$tmp_dir"
        error "源码克隆失败，请检查网络"
    }
    (cd "$tmp_dir/claw-cli" && npm install --production 2>&1 && npx tsc 2>&1) || {
        rm -rf "$tmp_dir"
        error "源码构建失败"
    }

    local bin_dir="$HOME/.local/bin"
    mkdir -p "$bin_dir"
    ln -sf "$tmp_dir/claw-cli/dist/cli.js" "$bin_dir/claw"
    chmod +x "$bin_dir/claw"

    # 添加到 PATH（根据 shell）
    add_to_path "$bin_dir"
    export PATH="$PATH:$bin_dir"
    info "✅ 从源码安装成功 (claw → $bin_dir/claw)"
}

add_to_path() {
    local bin_dir="$1"
    case "$CURRENT_SHELL" in
        zsh)
            if ! grep -q "$bin_dir" "$HOME/.zshrc" 2>/dev/null; then
                echo "export PATH=\"\$PATH:$bin_dir\"" >> "$HOME/.zshrc"
                info "已添加到 ~/.zshrc"
            fi
            ;;
        bash)
            if ! grep -q "$bin_dir" "$HOME/.bashrc" 2>/dev/null; then
                echo "export PATH=\"\$PATH:$bin_dir\"" >> "$HOME/.bashrc"
                info "已添加到 ~/.bashrc"
            fi
            ;;
        fish)
            if ! grep -q "$bin_dir" "$HOME/.config/fish/config.fish" 2>/dev/null; then
                echo "set -gx PATH \$PATH $bin_dir" >> "$HOME/.config/fish/config.fish"
                info "已添加到 fish config"
            fi
            ;;
    esac
}

# ═══════════════════════════════════════
# Step 3: 配置 Registry
# ═══════════════════════════════════════
configure_registry() {
    header "Step 3/6: 配置 Registry"

    local existing_url=""
    if [ -f "$CONFIG_FILE" ] && command -v jq >/dev/null 2>&1; then
        existing_url=$(jq -r '.registry // empty' "$CONFIG_FILE" 2>/dev/null || echo "")
    fi

    if [ -n "$existing_url" ]; then
        info "当前 Registry: $existing_url"
        local use_existing=$(ask "使用此配置？(Y/n)" "Y")
        if [ "$use_existing" = "Y" ] || [ "$use_existing" = "y" ]; then
            REGISTRY_URL="$existing_url"
            return
        fi
    fi

    REGISTRY_URL=$(ask "Registry Git 仓库地址" "git@github.com:mosqlee/claw-registry.git")

    # 校验 URL
    validate_git_url "$REGISTRY_URL" || {
        REGISTRY_URL=$(ask "请输入有效的 Git 地址（git@ 或 https://）")
        validate_git_url "$REGISTRY_URL" || error "无效的 Git URL"
    }

    # 保存配置（使用 jq，安全）
    mkdir -p "$CLAW_STORE"
    if [ -f "$CONFIG_FILE" ]; then
        local tmp=$(mktemp)
        jq --arg url "$REGISTRY_URL" '.registry = $url' "$CONFIG_FILE" > "$tmp" && mv "$tmp" "$CONFIG_FILE"
    else
        echo "{\"registry\": \"$REGISTRY_URL\"}" > "$CONFIG_FILE"
    fi
    info "Registry 已配置: $REGISTRY_URL"
}

# ═══════════════════════════════════════
# Step 4: 拉取 Registry
# ═══════════════════════════════════════
fetch_registry() {
    header "Step 4/6: 拉取 Registry 数据"

    mkdir -p "$REGISTRY_CACHE"
    local tmp_dir=$(mktemp -d)
    info "正在拉取 Registry..."

    if git clone --depth 1 --filter=blob:none --sparse "$REGISTRY_URL" "$tmp_dir/claw-registry" 2>/dev/null; then
        (cd "$tmp_dir/claw-registry" && git sparse-checkout set skills agents scenes 2>/dev/null) || true

        for dir in skills agents scenes; do
            if [ -d "$tmp_dir/claw-registry/$dir" ]; then
                rm -rf "${REGISTRY_CACHE:?}/$dir"
                cp -r "$tmp_dir/claw-registry/$dir" "$REGISTRY_CACHE/"
            fi
        done

        local skill_count=$(find "$REGISTRY_CACHE/skills" -name "package.json" -maxdepth 2 2>/dev/null | wc -l | tr -d ' ')
        local agent_count=$(find "$REGISTRY_CACHE/agents" -name "package.json" -maxdepth 2 2>/dev/null | wc -l | tr -d ' ')
        local scene_count=$(find "$REGISTRY_CACHE/scenes" -name "*.json" -maxdepth 1 2>/dev/null | wc -l | tr -d ' ')

        info "拉取完成: ${skill_count} skills, ${agent_count} agents, ${scene_count} scenes"
    else
        rm -rf "$tmp_dir"
        error "无法连接 Registry ($REGISTRY_URL)，请检查网络或 SSH key"
    fi

    rm -rf "$tmp_dir"
}

# ═══════════════════════════════════════
# 通用选择函数（兼容 bash 3.2）
# ═══════════════════════════════════════
SELECTED_ITEMS=""

select_items() {
    local title="$1"
    local list_dir="$2"
    local json_key="$3"  # package.json or scene json 的 key

    SELECTED_ITEMS=""

    # 收集可用项
    local items=""
    if [ -d "$list_dir" ]; then
        for f in "$list_dir"/*.json; do
            [ -f "$f" ] || continue
            items="$items $(basename "$f" .json)"
        done
    fi
    for d in "$list_dir"/*/; do
        [ -d "$d" ] || continue
        local name=$(basename "$d")
        [[ " $items " =~ " $name " ]] || items="$items $name"
    done
    items=$(echo "$items" | xargs)  # trim

    if [ -z "$items" ]; then
        warn "暂无可选项"
        return 1
    fi

    echo -e "\n${BOLD}${title}${NC}"
    local i=1
    local idx_map=""  # "index:name"
    for item in $items; do
        # 尝试读取描述
        local desc=""
        local extra=""
        if [ -f "$list_dir/${item}.json" ]; then
            desc=$(jq -r '.description // empty' "$list_dir/${item}.json" 2>/dev/null || echo "")
            local sub_skills=$(jq -r '.skills // [] | join(", ")' "$list_dir/${item}.json" 2>/dev/null || echo "")
            local sub_agents=$(jq -r '.agents // [] | join(", ")' "$list_dir/${item}.json" 2>/dev/null || echo "")
            [ -n "$sub_skills" ] && extra="Skills: $sub_skills"
            [ -n "$sub_agents" ] && extra="${extra:+$extra | }Agents: $sub_agents"
        elif [ -f "$list_dir/${item}/package.json" ]; then
            desc=$(jq -r '.description // empty' "$list_dir/${item}/package.json" 2>/dev/null || echo "")
        fi

        local line="  ${CYAN}${i})${NC} $item"
        [ -n "$desc" ] && line="$line — $desc"
        echo -e "$line"
        [ -n "$extra" ] && echo -e "     $extra"

        idx_map="$idx_map $i:$item"
        i=$((i + 1))
    done

    echo -e "  ${DIM}0) 跳过${NC}"
    echo ""
    local choice=$(ask "输入编号选择（多选用空格分隔，0 跳过）" "0")

    if [ "$choice" = "0" ] || [ -z "$choice" ]; then
        return 0
    fi

    for num in $choice; do
        # 在 idx_map 中查找
        local found=""
        for mapping in $idx_map; do
            local idx="${mapping%%:*}"
            local name="${mapping#*:}"
            if [ "$idx" = "$num" ]; then
                found="$name"
                break
            fi
        done
        if [ -n "$found" ]; then
            # 去重
            if ! echo " $SELECTED_ITEMS " | grep -q " $found "; then
                SELECTED_ITEMS="$SELECTED_ITEMS $found"
            fi
        fi
    done

    SELECTED_ITEMS=$(echo "$SELECTED_ITEMS" | xargs)
}

# ═══════════════════════════════════════
# Step 5: 选择场景/Agent/Skill
# ═══════════════════════════════════════
select_and_install() {
    header "Step 5/6: 选择安装内容"

    # 场景
    if select_items "🎬 可用场景（选择场景会自动安装其中包含的 agent 和 skill）" "$REGISTRY_CACHE/scenes" "scene"; then
        SCENES="$SELECTED_ITEMS"
    else
        SCENES=""
    fi

    # Agent
    if select_items "🤖 可用 Agents" "$REGISTRY_CACHE/agents" "agent"; then
        AGENTS="$SELECTED_ITEMS"
    else
        AGENTS=""
    fi

    # Skill
    if select_items "🧩 可用 Skills" "$REGISTRY_CACHE/skills" "skill"; then
        SKILLS="$SELECTED_ITEMS"
    else
        SKILLS=""
    fi

    # 汇总
    echo -e "\n${BOLD}📋 安装计划：${NC}"
    [ -n "$SCENES" ] && echo -e "  🎬 场景: $SCENES"
    [ -n "$AGENTS" ] && echo -e "  🤖 Agents: $AGENTS"
    [ -n "$SKILLS" ] && echo -e "  🧩 Skills: $SKILLS"

    local total=0
    for _ in $SCENES $AGENTS $SKILLS; do total=$((total + 1)); done

    if [ "$total" -eq 0 ]; then
        warn "未选择任何内容，跳过安装"
        return
    fi

    echo ""
    local confirm=$(ask "确认安装？(Y/n)" "Y")
    [ "$confirm" = "n" ] && { warn "已取消"; return; }

    # 展开场景中的 agent 和 skill
    for scene in $SCENES; do
        local scene_file="$REGISTRY_CACHE/scenes/${scene}.json"
        [ -f "$scene_file" ] || continue

        echo -e "\n${BOLD}🎬 展开场景: $scene${NC}"
        local scene_agents=$(jq -r '.agents // [] | join(" ")' "$scene_file" 2>/dev/null || echo "")
        local scene_skills=$(jq -r '.skills // [] | join(" ")' "$scene_file" 2>/dev/null || echo "")

        for a in $scene_agents; do
            if ! echo " $AGENTS " | grep -q " $a "; then
                AGENTS="$AGENTS $a"
            fi
        done
        for s in $scene_skills; do
            if ! echo " $SKILLS " | grep -q " $s "; then
                SKILLS="$SKILLS $s"
            fi
        done
    done

    # 去重安装
    local installed=""
    for a in $AGENTS; do
        if ! echo " $installed " | grep -q " $a "; then
            echo -e "  📦 安装 agent/$a..."
            claw install "$a" 2>&1 | sed 's/^/     /' || warn "  agent/$a 安装失败"
            installed="$installed $a"
        fi
    done
    for s in $SKILLS; do
        if ! echo " $installed " | grep -q " $s "; then
            echo -e "  📦 安装 skill/$s..."
            claw install "$s" 2>&1 | sed 's/^/     /' || warn "  skill/$s 安装失败"
            installed="$installed $s"
        fi
    done
}

# ═══════════════════════════════════════
# Step 6: 环境变量配置
# ═══════════════════════════════════════
check_env_vars() {
    header "Step 6/6: 环境变量配置"

    local all_vars=""
    # 收集所有 .env.example 中的变量名
    for env_example in "$CLAW_STORE/packages"/*/.env.example; do
        [ -f "$env_example" ] || continue
        while IFS= read -r line; do
            local var=$(echo "$line" | sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p')
            [ -n "$var" ] && all_vars="$all_vars $var"
        done < "$env_example"
    done
    all_vars=$(echo "$all_vars" | tr ' ' '\n' | sort -u | xargs)

    if [ -z "$all_vars" ]; then
        info "无需配置环境变量"
        return
    fi

    echo -e "${BOLD}以下环境变量需要配置：${NC}"
    for v in $all_vars; do
        echo -e "  🔑 $v"
    done
    echo ""

    local configure_now=$(ask "现在配置？(Y/n)" "Y")
    [ "$configure_now" = "n" ] && { warn "跳过，可稍后手动配置"; return; }

    for var in $all_vars; do
        local value
        if echo "$var" | grep -qiE 'URL|HOST|PORT|PATH|DIR|BASE|HOME|ROOT'; then
            value=$(ask "  📍 $var" "")
        else
            value=$(ask "  🔑 $var" "")
        fi

        if [ -n "$value" ]; then
            info "  $var = *** (已记录)"
            # 写入对应包的 .env
            for env_dir in "$CLAW_STORE/packages"/*/; do
                [ -d "$env_dir" ] || continue
                local example="$env_dir/.env.example"
                local env_file="$env_dir/.env"
                [ -f "$example" ] || continue
                if grep -q "^${var}=" "$example" 2>/dev/null; then
                    if [ -f "$env_file" ] && grep -q "^${var}=" "$env_file" 2>/dev/null; then
                        # macOS sed 兼容
                        local tmp_env=$(mktemp)
                        sed "s|^${var}=.*|${var}=${value}|" "$env_file" > "$tmp_env" && mv "$tmp_env" "$env_file"
                    else
                        echo "${var}=${value}" >> "$env_file"
                    fi
                fi
            done
        fi
    done

    info "✅ 环境变量配置完成"
}

# ═══════════════════════════════════════
# 完成
# ═══════════════════════════════════════
show_summary() {
    header "🎉 安装完成！"

    echo -e "
${BOLD}后续操作：${NC}
  claw doctor          # 检查环境
  claw list            # 查看已安装的包
  claw search <query>  # 搜索更多包
  claw verify          # 校验安装完整性

${BOLD}配置文件位置：${NC}
  Registry: $CONFIG_FILE
  已安装包: $CLAW_STORE/packages/

${BOLD}Skill 安装目录：${NC}
  $SKILLS_DIR
  (将 claw-cli 仓库中的 skill/claw-cli-manager/ 复制到此处即可启用 AI 管理)
"
}

# ═══════════════════════════════════════
# Main
# ═══════════════════════════════════════
main() {
    echo -e "\n${BOLD}${CYAN}╔══════════════════════════════════════╗${NC}"
    echo -e "${BOLD}${CYAN}║   claw-cli 交互式安装向导             ║${NC}"
    echo -e "${BOLD}${CYAN}╚══════════════════════════════════════╝${NC}"

    check_environment
    install_claw_cli
    configure_registry
    fetch_registry
    select_and_install
    check_env_vars
    show_summary
}

main "$@"
