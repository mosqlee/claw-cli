# claw-cli

> 📦 Package Manager for OpenClaw Skills & Agents

`claw` 是 [OpenClaw](https://github.com/openclaw/openclaw) 生态的包管理器，类似 npm/pip 的体验，用于搜索、安装、发布和管理 **Skills**（能力模块）与 **Agents**（角色模板）。

## 特性

- 🔍 **搜索发现** — 从 Registry 搜索可用的 Skills 和 Agents
- 📥 **一键安装** — `claw install <name>` 自动下载、部署、配置环境变量
- 📤 **发布共享** — `claw publish <dir>` 将本地包发布到 Registry
- 🧩 **Agent 管理** — 安装 Agent 角色模板，查看 SOUL.md 人设
- 📦 **离线打包** — `claw pack` 创建 tarball，支持离线环境部署
- 🔐 **完整性校验** — SHA256 哈希验证已安装包的完整性
- 🛠️ **环境自检** — 自动检测并引导配置环境变量

## 安装

```bash
# 从源码安装
git clone https://github.com/mosqlee/claw-cli.git
cd claw-cli
npm install
npm run build
npm link
```

**要求**：Node.js >= 18

## 快速开始

```bash
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

### 项目结构

```
claw-cli/
├── src/
│   ├── cli.ts          # CLI 入口（commander 命令定义）
│   ├── registry.ts     # Registry 管理（publish/fetch/search）
│   ├── package.ts      # 安装/卸载/验证/Agent 管理
│   ├── packer.ts       # 离线打包/解包
│   ├── utils.ts        # 工具函数（路径、哈希、解析等）
│   ├── types.ts        # TypeScript 类型定义
│   └── index.ts        # 模块导出
├── test/
│   └── utils.test.ts   # 单元测试
├── Dockerfile          # Docker 黑盒测试
├── test-blackbox.sh    # 黑盒测试脚本
├── package.json
└── tsconfig.json
```

## License

MIT
