# Download and install / 下载与安装

Open [GitHub Releases](https://github.com/theAfish/open-agent-world/releases), select a published version, and expand **Assets**. If there are no published releases yet, installers are not publicly available yet.

| Your computer | Download |
| --- | --- |
| Windows x64 | `Open-Agent-World-<version>-windows-x64.exe` |
| Apple Silicon Mac | `Open-Agent-World-<version>-macos-arm64.dmg` |
| Intel Mac | `Open-Agent-World-<version>-macos-x86_64.dmg` |

普通用户请选择上面的安装包，**不要下载 Source code (zip / tar.gz)**，那是开发者使用的源码。Mac 可在“关于本机”查看芯片类型。`.sha256` 是可选的文件校验信息，不是安装包。

## Windows

Run the installer, then launch **Open Agent World** from the Start menu. Python, application dependencies and the frontend are included; Node.js, Rust and a source checkout are unnecessary. WebView2 may download during installation if missing.

The initial builds are unsigned. If Windows shows a reputation warning, check that the file came from this repository's Release before deciding whether to continue. Managed devices may require administrator assistance.

## macOS preview

Open the DMG and drag **Open Agent World** into **Applications**, then launch it. Builds currently use ad-hoc signing and are not notarized by Apple. If macOS blocks opening, review **System Settings → Privacy & Security** for the blocked app and an **Open Anyway** option, if available and you trust this download. Do not disable system security globally. Report a damaged-app error with the release version and Mac architecture if it cannot be opened.

macOS currently has **no local Sandbox runtime**. The desktop preview does not imply support for plugins or actions requiring that runtime.

## First use

1. 在 **Settings → Models** 添加模型连接、API 凭据和模型，选择默认模型。
2. 跟随画布上的首次使用教程；也可以使用指南针按钮重播。
3. 打开 **Pack & Card Library** 收集卡片，然后添加到画布。

You can explore the canvas before configuring a model. Model calls require your configured service; some plugins and Sandbox environments download dependencies on first use.

## Updates and troubleshooting

Download and install the next release manually; automatic updates are not configured. User data is stored separately and retained across upgrades and uninstall. See [desktop profiles and logs](desktop.md) for data locations and startup diagnostics.

When reporting a problem, include your OS, CPU architecture, release version and the error shown. Remove credentials from any logs you share.
