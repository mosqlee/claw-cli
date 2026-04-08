---
name: claw-cli-manager
description: OpenClaw 包管理器（claw-cli）的安装、配置和使用。管理 Skills 和 Agents 的搜索、安装、发布。触发词：安装skill、安装agent、发布skill、发布agent、claw、场景安装、角色配置。
---

# Claw CLI Manager - OpenClaw 包管理器

通过 `claw` CLI 管理团队内部的 Skills（能力模块）和 Agents（角色模板）的搜索、安装、发布和场景编排。

## 核心定位

- **目标用户**：OpenClaw 用户（程序员），需要在小团队内共享 skill/agent
- **核心价值**：一键安装、私有 Registry、场景套件编排
- **npm 包名**：`openclaw-claw`（`claw-cli` 已被占用）

## 前置条件

- Node.js >= 18
- Git（已配置 SSH key 或 token 访问私有 registry repo）

## 交互式安装

当用户说「初始化 claw-cli」或「安装 claw」或「setup claw」时，执行交互式安装向导：

```bash
bash ~/.openclaw/workspace/skills/claw-cli-manager/scripts/setup.sh
```

该脚本会依次引导用户完成：
1. **环境检查** — Node.js、npm、Git、OpenClaw 安装状态
2. **安装 claw-cli** — npm 全局安装（失败自动回退源码安装）
3. **配置 Registry** — 输入私有仓库地址
4. **拉取 Registry** — 从远程拉取 skills/agents/scenes 列表
5. **选择安装内容** — 场景（多选/跳过）→ Agent（多选/跳过）→ Skill（多选/跳过）
6. **环境变量配置** — 收集所有已安装包的 env 需求，引导用户填写

## 快速命令

## 日常命令

### 搜索

```bash
claw search [query]           # 搜索所有包
claw search stock             # 搜索包含"stock"的包
```

### 安装

```bash
claw install <package>        # 安装 skill 或 agent
claw install findata-toolkit  # 示例
claw install stock-analyst@1.2.0  # 指定版本
```

安装流程：
1. `claw install <name>` 从 registry 下载包
2. 自动部署到 `~/.openclaw/skills/<name>/` 或 `~/.openclaw/agents/<name>/`
3. 如果包有依赖声明，提示用户安装
4. 安装后执行 `claw verify <name>` 校验完整性

### 发布

```bash
claw publish <source-dir>              # 发布到 registry
claw publish ./my-skill                # 示例
claw publish ./my-skill --scope skill  # 指定类型
```

发布前自动检查：
- `package.json` 存在且格式正确
- `SKILL.md` 或 `SOUL.md` 存在
- 自动扫描敏感信息（API key、密码等）并生成 `.env.example`
- 自动生成/更新 registry index

### 查看与管理

```bash
claw list                    # 列出已安装的包
claw verify                  # 验证所有已安装包的完整性
claw verify <name>           # 验证指定包
claw uninstall <name>        # 卸载包
```

### Agent 管理

```bash
claw agent install <name>    # 安装 Agent
claw agent soul <name>       # 查看 Agent 人设
```

### 场景编排

场景 = 预定义的 skill + agent 套件，一键部署。

```bash
# 通过交互式脚本选择角色
bash ~/.openclaw/workspace/skills/claw-cli-manager/scripts/setup_scene.sh

# 或直接指定场景
claw scene init <name> --desc "描述"
claw scene add <package>
claw scene install
```

**场景套件**：场景配置存储在 Registry 的 `scenes/` 目录下，通过 `setup_scene.sh` 自动拉取。任何人都可以向 Registry 提交新的场景 JSON 来添加角色套件。

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

### 离线部署

```bash
claw pack <name> --output ./offline/        # 打包
claw install-pack ./offline/<name>.tar.gz   # 离线安装
```

## AI 调用指南

当用户说以下话时，自动映射到 claw 命令：

| 用户说 | AI 执行 |
|--------|---------|
| 「初始化 claw-cli」「setup claw」 | 执行 `setup.sh` 交互式向导 |
| 「帮我装xxx skill」 | `claw search xxx` → 展示结果 → `claw install <name>` |
| 「搜索xxx相关的skill」 | `claw search xxx` → 格式化展示 |
| 「发布我的skill」 | 引导到 skill 目录 → `claw publish <dir>` |
| 「装个交易员套件」 | 执行 `setup_scene.sh` 自动拉取 registry 场景列表 |
| 「有哪些角色套件」 | 执行 `setup_scene.sh` 拉取并展示 |
| 「列出已安装的skill」 | `claw list` → 格式化展示 |
| 「claw doctor」 | 直接执行 → 根据结果建议修复 |

### AI 调用示例

```bash
# 用户: "帮我装个股票分析相关的skill"
# AI 执行:
claw search stock
# 输出结果后让用户选择，然后:
claw install findata-toolkit

# 用户: "发布我刚才写的 my-skill"
# AI 执行:
claw publish ~/.openclaw/workspace/skills/my-skill
```

## 包格式要求

一个合法的 claw 包：

```
my-skill/
├── package.json        # 必需，包含 name/version/type
├── SKILL.md            # Skill 必需
├── SOUL.md             # Agent 必需
└── scripts/            # 可选
```

package.json 最低要求：
```json
{
  "name": "my-skill",
  "version": "1.0.0",
  "type": "skill"
}
```

## 存储结构

```
~/.claw_store/
├── registry/              # Registry 本地缓存
│   ├── skill/
│   └── agent/
└── packages/              # 已安装的包
```

## 异常处理

| 异常 | 处理 |
|------|------|
| Node.js 版本不满足 | 提示升级，终止安装 |
| Git 权限不足 | 提示检查 SSH key / token |
| Registry 未配置 | 提示执行 `claw config set registry <url>` |
| 包已存在 | 提示覆盖/跳过 |
| install 校验失败 | 自动 rollback，删除不完整文件 |
| publish 格式错误 | 列出具体问题，拒绝发布 |

## 注意事项

- 使用前必须先 `claw config set registry <url>` 配置私有仓库
- publish 会自动扫描敏感信息，但请人工复核
- 建议定期执行 `claw verify` 检查已安装包完整性
