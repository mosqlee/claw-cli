# openclaw-claw

> 📦 Package Manager for OpenClaw Skills & Agents

`claw` 是 [OpenClaw](https://github.com/openclaw/openclaw) 生态的包管理器，类似 npm/pip 的体验，用于搜索、安装、发布和管理 **Skills**（能力模块）与 **Agents**（角色模板）。

## 特性

- 🔍 **搜索发现** — 从 Registry 搜索可用的 Skills 和 Agents
- 📥 **一键安装** — `claw install <name>` 自动下载、部署、配置环境变量
- 🚀 **自动部署** — 安装后自动部署到 `~/.openclaw/` 目录（Agent/Skill 分别部署）
- 📤 **发布共享** — `claw publish <dir>` 将本地包发布到 Registry
- 🧩 **Agent 管理** — 安装 Agent 角色模板，查看 SOUL.md 人设
- 📦 **离线打包** — `claw pack` 创建 tarball，支持离线环境部署
- 🔄 **自更新** — `claw update` 自动检测安装方式并更新 CLI
- 🔐 **完整性校验** — SHA256 哈希验证已安装包的完整性
- 🛠️ **环境自检** — 自动检测并引导配置环境变量
- ✅ **测试覆盖** — 184 个单元/集成测试，覆盖所有核心模块

## 安装

```bash
# 推荐：npm 全局安装
npm install -g openclaw-claw

# 或从源码安装
git clone https://github.com/mosqlee/claw-cli.git
cd claw-cli
npm install
npm run build
npm link
```

**要求**：Node.js >= 18

## 快速开始

```bash
# 配置私有 Registry
claw config set registry git@github.com:mosqlee/claw-registry.git

# 检查环境
claw doctor

# 搜索包
claw search stock
claw search

# 安装一个 Skill
claw install findata-toolkit

# 安装一个 Agent
claw agent install stock-analyst

# 查看 Agent 人设
claw agent soul stock-analyst

# 列出已安装的包
claw list

# 验证已安装包的完整性
claw verify

# 更新 claw CLI
claw update

# 仅检查是否有新版本
claw update --check
```

## 命令参考

### 核心命令

| 命令 | 说明 |
|------|------|
| `claw doctor` | 检查运行环境 |
| `claw search [query]` | 搜索 Registry 中的包 |
| `claw install <package>` | 安装包（格式：`name` 或 `name@version`） |
| `claw uninstall <name>` | 卸载包 |
| `claw list` | 列出已安装的包 |
| `claw verify` | 验证已安装包的完整性 |
| `claw publish <source-dir> [--scope <scope>]` | 发布包到本地 Registry |
| `claw pack <name> [--output <dir>]` | 将已安装的包打包为离线 tarball |
| `claw install-pack <tarball>` | 从离线 tarball 安装包 |
| `claw update [--check]` | 更新 claw CLI（`--check` 仅检查版本） |

### Agent 管理

| 命令 | 说明 |
|------|------|
| `claw agent install <name>` | 安装 Agent（等同于 `claw install` 但限定 agent 作用域） |
| `claw agent soul <name>` | 查看 Agent 的 SOUL.md 人设文件 |

### 环境管理

| 命令 | 说明 |
|------|------|
| `claw env check` | 检查环境工具链 |
| `claw env setup` | 初始化项目环境 |

## 包格式

一个 claw 包就是一个目录，包含以下文件：

```
my-skill/
├── package.json        # 包元数据（必需）
├── SKILL.md            # Skill 定义文件（Skill 必需）
├── SOUL.md             # Agent 人设文件（Agent 必需）
├── AGENTS.md           # Agent 配置文件（Agent 可选）
├── scripts/            # 脚本目录（可选）
├── TOOLS.md            # 工具说明（可选）
└── TOOLS.template.md   # 工具模板（可选）
```

### package.json

```json
{
  "name": "findata-toolkit",
  "version": "1.0.0",
  "type": "skill",
  "description": "A股金融数据工具包",
  "dependencies": {
    "akshare": "^1.12.0"
  }
}
```

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `name` | string | ✅ | 包名（小写、连字符） |
| `version` | string | 推荐 | 语义化版本号 |
| `type` | string | 推荐 | `skill` 或 `agent` |
| `description` | string | 可选 | 包描述 |
| `dependencies` | object | 可选 | 依赖声明 |

### 环境变量自动检测

`claw publish` 会自动扫描包中的文件，检测以下格式的环境变量引用：

- `export VAR_NAME`
- `os.environ["VAR_NAME"]` / `os.getenv("VAR_NAME")`
- 注释中的 `环境变量：VAR_NAME`

检测到的变量会自动生成 `.env.example` 文件。安装时 `claw install` 会交互式引导用户填写。

## 存储结构

```
~/.claw_store/
├── registry/              # 包仓库（publish 写入，install 读取）
│   ├── skill/
│   │   ├── findata-toolkit/
│   │   │   ├── package.json
│   │   │   ├── SKILL.md
│   │   │   └── scripts/
│   │   └── weather/
│   └── agent/
│       └── stock-analyst/
│           ├── package.json
│           └── SOUL.md
└── packages/              # 已安装的包
    ├── skill__findata-toolkit/
    └── agent__stock-analyst/

~/.openclaw/               # OpenClaw 运行时目录（安装后自动部署）
├── agents/
│   └── stock-analyst/
│       └── agent/         # Agent 完整包
├── workspace/
│   └── skills/
│       └── findata-toolkit/  # Skill 完整包
└── openclaw.json          # Agent 注册信息自动更新
```

## 离线部署

```bash
# 1. 在联网机器上打包
claw install findata-toolkit
claw pack findata-toolkit --output ./offline/

# 2. 拷贝 tarball 到离线机器，然后安装
claw install-pack ./offline/findata-toolkit-1.0.0.tar.gz
```

## 开发

```bash
# 构建
npm run build

# 运行测试
npm test

# 开发模式（监听文件变化）
npm run dev

# 代码检查
npm run lint
```

## 交互式安装向导

推荐新用户使用交互式安装脚本，一键完成所有配置：

```bash
bash <(curl -sL https://raw.githubusercontent.com/mosqlee/claw-cli/main/scripts/setup.sh)
```

或本地执行：

```bash
git clone https://github.com/mosqlee/claw-cli.git
cd claw-cli
bash scripts/setup.sh
```

安装向导会依次引导你完成：

1. **环境检查** — 检测 Node.js (>=18)、npm、Git、jq
2. **安装 claw-cli** — npm 全局安装（失败自动回退源码安装）
3. **配置 Registry** — 输入私有仓库地址（支持 git@ 和 https://）
4. **拉取 Registry** — 从远程拉取 skills/agents/scenes 列表
5. **选择安装内容** — 场景（多选/跳过）→ Agent（多选/跳过）→ Skill（多选/跳过）
6. **环境变量配置** — 收集所有已安装包的 env 需求，引导填写

### 前置要求

- Node.js >= 18
- npm
- Git
- **jq** — JSON 解析（`brew install jq`）
- Registry 的 SSH key 或访问权限

### 手动安装

如果不想用交互式向导，也可以手动安装：

```bash
npm install -g openclaw-claw
claw config set registry git@github.com:mosqlee/claw-registry.git
claw doctor
claw search stock
claw install findata-toolkit
```

## claw-cli-manager Skill

本项目附带一个 OpenClaw Skill（`skill/claw-cli-manager/`），让你的 AI 助手能够自动使用 claw-cli 管理包。

### 安装 Skill

```bash
cp -r skill/claw-cli-manager ~/.openclaw/workspace/skills/
```

然后重启 OpenClaw。AI 助手支持的触发词：

| 用户说 | AI 执行 |
|--------|---------|
| 「初始化 claw-cli」「setup claw」 | 执行 `setup.sh` 交互式向导 |
| 「帮我装xxx skill」 | `claw search xxx` → 展示结果 → `claw install <name>` |
| 「搜索xxx相关的skill」 | `claw search xxx` → 格式化展示 |
| 「发布我的skill」 | 引导到 skill 目录 → `claw publish <dir>` |
| 「装个交易员套件」 | 执行 `setup_scene.sh` 拉取场景列表 |
| 「有哪些角色套件」 | 执行 `setup_scene.sh` 拉取并展示 |
| 「列出已安装的skill」 | `claw list` → 格式化展示 |
| 「claw doctor」 | 直接执行 → 根据结果建议修复 |

### 场景套件

场景配置存储在 Registry 的 `scenes/` 目录下，运行脚本时自动拉取。任何团队成员可以向 Registry 提交 JSON 文件来添加新场景。

场景 JSON 格式：

```json
{
  "name": "trader",
  "description": "A股交易员工作台",
  "skills": ["findata-toolkit", "bollinger-bands-analyzer"],
  "agents": ["stock-analyst"],
  "env": {}
}
```

### 使用场景安装脚本

```bash
# 交互式选择角色（自动从 Registry 拉取最新场景列表）
bash ~/.openclaw/workspace/skills/claw-cli-manager/scripts/setup_scene.sh

# 或直接指定角色名称
bash ~/.openclaw/workspace/skills/claw-cli-manager/scripts/setup_scene.sh trader
```

### 项目结构

```
claw-cli/
├── scripts/
│   └── setup.sh              # 交互式安装向导（新用户推荐）
├── src/
│   ├── cli.ts                # CLI 入口
│   ├── registry.ts           # Registry 管理
│   ├── package.ts            # 安装/卸载/验证
│   ├── packer.ts             # 离线打包/解包
│   ├── config.ts             # 配置管理
│   ├── scene.ts              # 场景管理
│   ├── updater.ts           # CLI 自更新
│   ├── utils.ts              # 工具函数
│   └── types.ts              # TypeScript 类型
├── src/*.test.ts            # 单元测试（164 tests）
├── test-integration/        # 集成测试（20 tests）
├── skill/
│   └── claw-cli-manager/     # OpenClaw Skill
│       ├── SKILL.md          # Skill 定义（AI 触发词 + 命令映射）
│       └── scripts/
│           ├── install_claw.sh   # 一键安装 claw-cli
│           └── setup_scene.sh   # 场景安装
├── test/
│   └── utils.test.ts
├── docs/
│   └── superpowers/specs/   # 设计文档
├── package.json
└── tsconfig.json
```

## License

MIT
