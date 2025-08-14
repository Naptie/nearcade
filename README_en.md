![nearcade](https://socialify.git.ci/Naptie/nearcade/image?font=Raleway&forks=1&issues=1&language=1&name=1&owner=1&pattern=Circuit+Board&pulls=1&stargazers=1&theme=Auto)

[中文](README.md) | **English**

A modern web application that helps gamers discover arcade gaming venues and connect with communities. Find the best spots to play popular rhythm games, join university clubs, and engage in discussions.

Please join the following QQ group for discussions.

<img src="static/group-chat-qq.jpg" alt="QR code for the nearcade QQ group" width="350"/>

## ✨ Features

### 🎯 Location-Based Discovery

- **My Location**: Use GPS to find arcades near your current position.
- **University Search**: Search for arcades near specific universities and campuses.
- **Map Selection**: Pick any location on an interactive map.
- **Customizable Radius**: Search within a 1~30 km radius.

### 🏆 Campus Rankings

- Compare universities by arcade density and machine availability.
- Metrics include shop count, total machines, and area density.
- Game-specific rankings for popular titles.
- Daily data updates with 24-hour cache refresh.

### 💬 Community & Social

- **User Accounts**: Sign up with QQ, Phira, osu!, GitHub, Discord, or Microsoft Account.
- **User Profiles**: Public profiles with activity feeds and privacy settings.
- **University Clubs**: Create and join clubs, participate in club-specific discussions.
- **Community Posts**: Share updates, ask questions, and comment on posts in a Markdown-enabled forum with LaTeX math support.
- **Notifications**: Get notified about new comments, replies, and club activities.

### 🎮 Supported Games

- maimai DX
- CHUNITHM
- Taiko no Tatsujin
- SOUND VOLTEX
- WACCA

## 🛠️ Technical Stack

### Frontend Framework

- **SvelteKit**: Full-stack framework with SSR/SPA capabilities.
- **Svelte 5**: Latest version with an enhanced reactivity system.
- **TypeScript**: Type-safe development throughout.

### Styling & UI

- **Tailwind CSS 4.0**: Utility-first CSS framework.
- **daisyUI**: Semantic component classes for Tailwind.
- **Font Awesome**: Comprehensive icon library.

### Backend & Database

- **MongoDB**: Primary database for all application data.
- **Auth.js (SvelteKitAuth)**: Handles user authentication and sessions.
- **Server-side API**: RESTful endpoints built with SvelteKit.

### Maps & Location Services

- **高德地图 (AMap) & 腾讯地图 (Tencent Maps)**: Mapping service integration.
- **Geolocation API**: Browser-based location detection.

### Internationalization

- **Paraglide.js**: Type-safe i18n solution.
- **Message-based Translation**: Structured translation system.

### Development Tools

- **Vite**: Fast build tool and development server.
- **ESLint**: Code linting with Svelte-specific rules.
- **Prettier**: Code formatting with plugin support.
- **pnpm**: Fast, disk space efficient package manager.

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- pnpm (recommended) or npm
- MongoDB instance
- AMap JS API key & secret
- Tencent Maps API key
- Sentry DSN (optional)
- Credentials for OAuth providers (including GitHub, Microsoft Entra ID, Discord, osu!, Phira, and QQ)

### Installation

1.  **Clone the repository:**

    ```bash
    git clone https://github.com/Naptie/nearcade.git
    cd nearcade
    ```

2.  **Install dependencies:**

    ```bash
    pnpm install
    ```

3.  **Set up environment variables:**

    Create a `.env` file in the root directory. See `.env.example` for a full list of variables.

    **Core Configuration:**

    ```env
    # Map Services
    PUBLIC_AMAP_KEY = "your_amap_key"
    PUBLIC_QQMAP_KEY = "your_qqmap_key"
    AMAP_SECRET = "your_amap_secret"

    # Database
    MONGODB_URI="mongodb://localhost:27017/?dbName=nearcade"

    # Auth Secret (generate a random string)
    AUTH_SECRET="your_random_auth_secret"
    ```

    **Authentication Providers:**

    ```env
    # GitHub
    AUTH_GITHUB_ID="your_github_oauth_id"
    AUTH_GITHUB_SECRET="your_github_oauth_secret"

    # Microsoft
    AUTH_MICROSOFT_ENTRA_ID_ID = "your_microsoft_entra_id_id"
    AUTH_MICROSOFT_ENTRA_ID_SECRET = "your_microsoft_entra_id_secret"
    AUTH_MICROSOFT_ENTRA_ID_ISSUER = "your_microsoft_entra_id_issuer"

    # Discord
    AUTH_DISCORD_ID="your_discord_oauth_id"
    AUTH_DISCORD_SECRET="your_discord_oauth_secret"

    # osu!
    AUTH_OSU_ID = "your_osu_oauth_id"
    AUTH_OSU_SECRET = "your_osu_oauth_secret"

    # Phira
    AUTH_PHIRA_ID = "your_phira_oauth_id"
    AUTH_PHIRA_SECRET = "your_phira_oauth_secret"

    # QQ
    AUTH_QQ_ID="your_qq_oauth_id"
    AUTH_QQ_SECRET="your_qq_oauth_secret"
    AUTH_QQ_PROXY="your_qq_redirect_proxy_url" # Optional redirect proxy
    ```

    **IMAP and Redis (For Student Status Verification):**

    ```env
    IMAP_HOST = "imap.example.com"
    IMAP_PORT = "993"
    IMAP_USER = "your_imap_user@example.com"
    IMAP_PASSWORD = "your_imap_password"
    REDIS_URI = "redis://username:password@127.0.0.1:6379"
    ```

4.  **Start development server:**

    ```bash
    pnpm dev
    ```

5.  **Open your browser:**
    Navigate to `http://localhost:5173`

### Building for Production

```bash
# Build the web application
pnpm build

# Preview the production build
pnpm preview
```

## 🚢 Running with Docker

### Prerequisites

- **Docker** and **Docker Compose** installed on your machine.

### Step-by-Step Guide

1.  **Clone the repository and navigate into it.**

2.  **Set up environment variables:**
    Create a `.env` file as described in the "Getting Started" section.

3.  **Build and start the services:**

    ```bash
    docker-compose up --build
    ```

4.  **Access the application:**
    Once the containers are running, navigate to `http://localhost:3000` in your browser.

### Stopping the Docker Containers

```bash
docker-compose down
```

---

## 🤝 Contributing

We welcome contributions! Please feel free to submit issues and pull requests.

### Development Guidelines

- Follow TypeScript best practices.
- Use Prettier for code formatting.
- Write meaningful commit messages.
- Test your changes thoroughly.

## ⭐ Stargazers Over Time

[![Stargazers over time](https://starchart.cc/Naptie/nearcade.svg?variant=adaptive)](https://starchart.cc/Naptie/nearcade)

## 📄 License

This project is open source and available under the [Mozilla Public License 2.0](LICENSE).

## 🙏 Acknowledgments

- [BEMANICN](https://map.bemanicn.com/)
