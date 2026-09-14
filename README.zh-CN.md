<div align="center">

<img src="docs/assets/logo.svg" alt="Open Agent World 标志" width="160" />

# Open Agent World

[English](README.md) | **简体中文**

**创建智能体，让它们协作，给它们一个可以工作的世界。**

一个可视化工作空间：将 AI 智能体、工具和资源化为卡牌，通过连线建立协作关系。

[下载](https://github.com/theAfish/open-agent-world/releases) / [安装（中英混排）](docs/install.md) / [文档](docs/README.zh-CN.md) / [插件（英文）](docs/plugins.md)

</div>

> **世界预览**：截图或简短演示 GIF 即将补充。
<!-- 补充已提交到仓库的图片，展示一个小型、可运行的世界。 -->

## 可以做什么？

- **创建智能体（Agent）。** 选择模型、编写指令，连接它可以使用的资源和工具。
- **组建团队。** 连接多个智能体，将它们组织成可复用的军团（Legion），通过任务板（Task Board）协调工作。
- **构建世界。** 在开放画布上布置共享文档、工具箱和隔离的沙盒（Sandbox），也可以通过插件添加新的卡牌类型。

## 快速开始

**安装桌面应用：** 打开 [Releases](https://github.com/theAfish/open-agent-world/releases)，展开 **Assets**，选择 Windows `.exe` 或与你的处理器匹配的 macOS 预览版 `.dmg`。详见[安装与首次使用（中英混排）](docs/install.md)。发布的安装包包含 Python 和应用依赖。**Source code** 压缩包供开发者使用。如果没有列出发行版，表示尚未发布公开安装包。

### 从源码运行

克隆仓库后，在仓库根目录运行以下命令。需要 **Python 3.11+**、**uv** 和 **Node.js 20+**。

**Windows（PowerShell）**

```powershell
./scripts/setup.ps1
./scripts/start.ps1
```

**Linux / WSL2**

```bash
bash scripts/setup.sh
python3 scripts/start.py
```

打开启动器输出的本地地址。在 **Settings > Models（设置 > 模型）** 中添加连接和模型，并选择默认模型。打开 **Pack & Card Library（卡包与卡牌库）**，收集卡牌并将它们加入牌组。

安装细节、macOS 限制，以及不配置模型凭据的体验方式，请参阅[入门指南](docs/getting-started.zh-CN.md)。

开发时使用 `./scripts/dev.ps1` 或 `python3 scripts/dev.py`，按 **F3** 可选择性重置状态或生成压力测试卡牌。开发环境使用独立配置目录，日常使用的数据保留在原位置。Windows 安装包、发布预览、配置目录位置和恢复备份详见[桌面安装与开发（英文）](docs/desktop.md)。

## 核心概念

**卡牌代表事物，连线授予访问权限，画布就是你的世界。** 智能体只能使用连线允许访问的资源；修改连线也会改变访问权限。[了解核心概念（英文）](docs/concepts.md)

## 学习与探索

- **[交互教程](docs/tutorial.zh-CN.md)**：从空画布跟随 OAW 向导开始，或使用指南针按钮重放教程，学习导航、卡牌、连线、粘合和 Minister。
- **[文档](docs/README.zh-CN.md)**：按需查阅功能用法、配置说明和技术参考。
- **[插件（英文）](docs/plugins.md)**：使用内置扩展，或开发自己的卡牌、能力和运行时集成。

## 参与贡献与许可证

欢迎报告问题、改进文档和提交范围明确的修改。提交前请阅读[开发与验证](docs/getting-started.zh-CN.md#开发与验证)。

OAW 是一个本地实验项目，仓库目前尚未包含许可证文件。
