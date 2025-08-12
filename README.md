![nearcade](https://socialify.git.ci/Naptie/nearcade/image?font=Raleway&forks=1&issues=1&language=1&name=1&owner=1&pattern=Circuit+Board&pulls=1&stargazers=1&theme=Auto)

**中文** | [English](README_en.md)

一个现代化的 Web 应用程序，旨在帮助游戏玩家发现街机游戏场所并与本地社群建立联系。在这里，您可以找到玩 maimai DX、CHUNITHM、SOUND VOLTEX 等流行节奏游戏的最佳地点，加入大学社团，并参与社区讨论。

欢迎加入 QQ 群进行交流。

<img src="static/group-chat-qq.jpg" alt="nearcade QQ 交流群二维码" width="350"/>

## ✨ 功能特性

### 🎯 基于位置的发现

- **我的位置**: 使用 GPS 查找您当前位置附近的街机厅。
- **大学搜索**: 搜索特定大学和校区附近的街机厅。
- **地图选点**: 在交互式地图上选择任意位置。
- **自定义半径**: 在 1 至 30 公里的半径内进行搜索。

### 🏆 校园排行

- 按街机密度和机台可用性对大学进行排名。
- 指标包括店铺数量、总机台数和区域密度。
- 提供流行游戏的专项排名。
- 数据每日更新，并有 24 小时缓存刷新机制。

### 💬 社区与社交

- **用户账户**: 支持使用 QQ、Phira、Osu!、GitHub、Discord 或微软账户注册。
- **用户资料**: 公开的个人主页，包含动态、隐私设置等。
- **大学社团**: 创建和加入大学社团，参与社团内部的讨论。
- **社区帖子**: 在支持 Markdown 的论坛中分享动态、提出问题和评论。
- **通知系统**: 获取关于新评论、回复和社团活动的通知。

### 🖥️ 跨平台支持

- **Web 应用**: 功能齐全的 Web 应用，可从任何现代浏览器访问。
- **桌面应用**: 基于 Tauri 的原生桌面应用，支持 Windows、macOS 和 Linux。

### 🎮 支持的游戏

- maimai DX
- CHUNITHM
- 太鼓の達人
- SOUND VOLTEX
- WACCA

## 🛠️ 技术栈

### 前端框架

- **SvelteKit**: 全栈框架，支持 SSR/SPA。
- **Svelte 5**: 最新版本，拥有增强的响应式系统。
- **TypeScript**: 全程提供类型安全。

### 样式与界面

- **Tailwind CSS 4.0**: 工具优先的 CSS 框架。
- **daisyUI**: 用于 Tailwind 的语义化组件库。
- **Font Awesome**: 全面的图标库。

### 后端与数据库

- **MongoDB**: 应用主数据库。
- **Auth.js (SvelteKitAuth)**: 处理用户认证和会话。
- **服务端 API**: 基于 SvelteKit 构建的 RESTful 端点。

### 地图与定位服务

- **高德地图 & 腾讯地图**: 地图服务集成。
- **Geolocation API**: 基于浏览器的定位检测。

### 跨平台开发

- **Tauri**: 使用 Web 技术构建原生桌面应用的框架。

### 国际化

- **Paraglide.js**: 类型安全的 i18n 解决方案。
- **基于消息的翻译**: 结构化的翻译体系。

### 开发工具

- **Vite**: 高性能的构建工具和开发服务器。
- **ESLint**: Svelte 特定的代码检查规则。
- **Prettier**: 支持插件的代码格式化工具。
- **pnpm**: 快速、高效的包管理器。

## 🚀 开始使用

### 环境要求

- Node.js 18+
- pnpm (推荐) 或 npm
- MongoDB 实例
- 高德地图 JS API 密钥和秘密
- 腾讯地图 API 密钥
- Sentry DSN (可选)
- 您希望支持的 OAuth 提供商的凭据 (GitHub, Discord 等)

### 安装步骤

1.  **克隆仓库:**

    ```bash
    git clone https://github.com/Naptie/nearcade.git
    cd nearcade
    ```

2.  **安装依赖:**

    ```bash
    pnpm install
    ```

3.  **设置环境变量:**

    在项目根目录创建一个 `.env` 文件。完整的变量列表请参考 `.env.example`。

    **核心配置:**
    ```env
    # 地图服务
    PUBLIC_AMAP_KEY="your_amap_key"
    PUBLIC_QQMAP_KEY="your_qqmap_key"
    AMAP_SECRET="your_amap_secret"

    # 数据库
    MONGODB_URI="mongodb://localhost:27017/nearcade"

    # Auth 密钥 (生成一个随机字符串)
    AUTH_SECRET="your_random_auth_secret"
    ```

    **认证提供商 (按需添加):**
    ```env
    # GitHub
    AUTH_GITHUB_ID="your_github_oauth_id"
    AUTH_GITHUB_SECRET="your_github_oauth_secret"

    # Discord
    AUTH_DISCORD_ID="your_discord_oauth_id"
    AUTH_DISCORD_SECRET="your_discord_oauth_secret"

    # QQ
    AUTH_QQ_ID="your_qq_oauth_id"
    AUTH_QQ_SECRET="your_qq_oauth_secret"
    AUTH_QQ_PROXY="your_qq_redirect_proxy_url" # 可选的重定向代理
    ```

4.  **启动开发服务器:**

    ```bash
    pnpm dev
    ```

5.  **打开浏览器:**
    访问 `http://localhost:5173`

### 构建生产版本

```bash
# 构建 Web 应用
pnpm build

# 预览生产版本
pnpm preview
```

### 构建桌面应用

要构建 Tauri 桌面应用，请运行:
```bash
pnpm tauri build
```

## 🚢 使用 Docker 运行

### 环境要求

- 已安装 **Docker** 和 **Docker Compose**。

### 操作指南

1.  **克隆仓库并进入项目目录。**

2.  **设置环境变量:**
    按照“开始使用”部分的说明创建 `.env` 文件。

3.  **构建并启动服务:**
    ```bash
    docker-compose up --build
    ```

4.  **访问应用:**
    容器启动后，在浏览器中访问 `http://localhost:3000`。

### 停止 Docker 容器

```bash
docker-compose down
```

---

## 🤝 参与贡献

我们欢迎各种形式的贡献！欢迎提交 Issues 和 Pull Requests。

### 开发准则

- 遵循 TypeScript 最佳实践。
- 使用 Prettier 进行代码格式化。
- 编写有意义的提交信息。
- 充分测试您的更改。

## ⭐ Stargazers 随时间变化

[![Stargazers over time](https://starchart.cc/Naptie/nearcade.svg?variant=adaptive)](https://starchart.cc/Naptie/nearcade)

## 📄 开源许可

本项目基于 [Mozilla Public License 2.0](LICENSE) 开源。

## 🙏 致谢

- [BEMANICN](https://map.bemanicn.com/)
