![nearcade](https://socialify.git.ci/Naptie/nearcade/image?font=Raleway&forks=1&issues=1&language=1&name=1&owner=1&pattern=Circuit+Board&pulls=1&stargazers=1&theme=Auto)

[中文](README.md) | **English**

A modern web application that helps gamers discover arcade gaming venues and connect with communities. Find the best spots to play popular rhythm games, join university clubs, and engage in discussions.

Please join the following QQ group for discussions.

<img src="static/group-chat-qq.webp" alt="QR code for the nearcade QQ group" width="350"/>

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
- maimai
- CHUNITHM
- SOUND VOLTEX
- beatmania IIDX
- jubeat
- NOSTALGIA
- GuitarFreaks
- DrumMania
- DANCERUSH STARDOM
- DanceDanceRevolution
- pop'n music
- DanceEvolution
- REFLEC BEAT
- Taiko no Tatsujin (Old Ver.)
- GROOVE COASTER
- WACCA
- PUMP IT UP
- TOP STAR
- DJMAX Technika
- Percussion Master
- Danz Base
- Hatsune Miku: Project DIVA Arcade
- O.N.G.E.K.I.
- DANCE aROUND
- Taiko no Tatsujin
- DANCE³ EVO
- jubeat (China)

### 🗃️ Data Collection

The arcade data is maintained by the community in principle. However, since the website did not have a maintenance system in its early versions, it mainly collected arcade data from third parties. For the purpose of informing the public, we are hereby disclosing the main data sources relied upon by the website in its early versions.

- Arcade shops in China (mainland, HK, MO, and TW) are collected from [BEMANICN's map](https://map.bemanicn.com/). Overseas aracde shops are collected from [Zenius -I- vanisher.com](https://zenius-i-vanisher.com/v5.2/arcades.php).
- A list of Chinese mainland universities is obtained from [MOE](http://www.moe.gov.cn/jyb_xxgk/s5743/s5744/A03/202506/t20250627_1195683.html), with additional campus geolocation data collected by [Naptie/cn-university-geocoder](https://github.com/Naptie/cn-university-geocoder) from [Tencent Maps](https://lbs.qq.com/).

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
- **Better Auth**: Handles user authentication, sessions, and email verification.
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

The local dev environment is fully containerized with Docker Compose: the app
itself plus MongoDB, Redis, Meilisearch, and MinIO all run in containers. The
app container reaches the backing services over the internal Compose network
only (via service names like `mongo`, `redis`) — **only the app's own dev
server is published to the host**.

### Prerequisites

- **Docker** and **Docker Compose** (the only hard requirement — the app runs in a container too)
- Node.js 18+ and pnpm (optional — only needed to run helper scripts like
  `pnpm dev:setup` / `pnpm seed:*` on the host; you can also run
  `bash scripts/dev-setup.sh` directly)

### One-command setup (recommended)

```bash
git clone https://github.com/Naptie/nearcade.git
cd nearcade

# Start the app and all backing services, and generate .env automatically
pnpm dev:setup
# or without Node/pnpm: bash scripts/dev-setup.sh

# Optional: restore seed data
pnpm dev:setup --seed
```

Once started, open `http://localhost:5173`. There is no need to run
`pnpm install` or `pnpm dev` on the host — the app container installs
dependencies and starts the dev server itself (with hot reload; your local
source is bind-mounted into the container).

`pnpm dev:setup` will:

1.  Generate a local `.env` from `.env.example`, filling in **random
    `SSC_SECRET` / `AUTH_SECRET`** and computing **`OSS_S3_BASE64`** from the
    MinIO config;
2.  Run `docker compose up -d --build --wait` to start **the app itself,
    MongoDB, Redis, Meilisearch, and MinIO** (including automatic bucket
    creation), and wait until the app container is ready.

> Existing values in `.env` are preserved; only missing/placeholder values are
> filled in. Add real keys for maps, Firebase push, mail delivery, etc. as needed.

### Seed data

Public data (`regions`, `counters`, `universities`, `shops`) can be exported
into sanitized seed data, then restored into the container MongoDB instance:

```bash
# Specify the source via the SEED_SOURCE env var or the --source argument.
SEED_SOURCE=mongodb://host:27017/?dbName=nearcade pnpm seed:dump
# or
pnpm seed:dump -- --source mongodb://host:27017/?dbName=nearcade

# Restore into / clear the local MongoDB.
# Must run inside the app container, because the local MongoDB is not exposed
# to the host by default:
docker compose exec app pnpm seed:restore
docker compose exec app pnpm seed:clear
```

`pnpm dev:setup --seed` already runs `docker compose exec app pnpm seed:restore`
for you.

### Manual environment configuration (optional)

If you don't want to use `pnpm dev:setup`, create `.env` by hand following
`.env.example`. Core configuration:

```env
# Database — the app container reaches it over the internal Compose network,
# so use the service name, not localhost
MONGODB_URI="mongodb://mongo:27017/?dbName=nearcade"

# Server-to-Server Communication Secret (generate a random string)
SSC_SECRET="your_ssc_secret"

# Auth Secret (generate a random string)
AUTH_SECRET="your_random_auth_secret"

# Redis
REDIS_URI = "redis://redis:6379"

# Meilisearch
MEILISEARCH_HOST = "http://meilisearch:7700"
MEILISEARCH_API_KEY = "dev-master-key"
```

> MongoDB, Redis, Meilisearch, and MinIO are **not** exposed to the host by
> default — the app container shares a Compose network with them and reaches
> them by service name, so it doesn't matter whether you already have the same
> kind of service installed on the host. To inspect data directly from the
> host (mongosh, RedisInsight, MinIO console, etc.), uncomment the relevant
> `ports:` block in `docker-compose.yml` and re-run `docker compose up -d`.

**Authentication Providers (GitHub required, others optional):**

```env
# GitHub
AUTH_GITHUB_ID="your_github_oauth_id"
AUTH_GITHUB_SECRET="your_github_oauth_secret"

# Optional: Microsoft / Discord / osu! / Phira / QQ
# AUTH_MICROSOFT_ENTRA_ID_ID = "..."
# AUTH_MICROSOFT_ENTRA_ID_SECRET = "..."
# AUTH_MICROSOFT_ENTRA_ID_ISSUER = "..."
# AUTH_DISCORD_ID = "..."
# AUTH_DISCORD_SECRET = "..."
# AUTH_OSU_ID = "..."
# AUTH_OSU_SECRET = "..."
# AUTH_PHIRA_ID = "..."
# AUTH_PHIRA_SECRET = "..."
# AUTH_QQ_ID = "..."
# AUTH_QQ_SECRET = "..."
```

Unconfigured OAuth providers are simply not registered — no button appears and
startup is unaffected.

**Object Storage Service (optional; MinIO is configured automatically):**

```env
# Setup either LeanCloud or S3; prefers S3 if both have valid configuration

# LeanCloud
OSS_LEANCLOUD_APP_ID = "your_leancloud_app_id"
OSS_LEANCLOUD_APP_KEY = "your_leancloud_app_key"
OSS_LEANCLOUD_SERVER_URL = "https://oss.example.com"

# S3 config JSON (use Base64 encoding)
# Example (local Docker uses the internal service name minio):
# {
#   "endpoint": "http://minio:9000",
#   "region": "us-east-1",
#   "bucket": "nearcade",
#   "accessKeyId": "minioadmin",
#   "secretAccessKey": "minioadmin",
#   "bucketEndpoint": false,
#   "forcePathStyle": true
# }
OSS_S3_BASE64 = "your_base64_content"
```

**Firebase Cloud Messaging:**

```env
# Setup either of the following variables

# Google Service Account JSON (use Base64 encoding)
GSAK_BASE64="your_base64_content"

# Firebase Cloud Messaging Proxy
FCM_PROXY="https://example.com/api/notifications/fcm/send"
```

For Firebase Cloud Messaging proxy setup, please refer to [this endpoint](src/routes/api/notifications/fcm/send/+server.ts).

Once `.env` is configured, run `docker compose up -d --build --wait`, then open
`http://localhost:5173`.

### Building for Production

```bash
# Build the web application
pnpm build

# Preview the production build
pnpm preview
```

## 🐳 Common Docker operations

- **View app logs (including hot-reload output):** `docker compose logs -f app`
- **Reinstall dependencies after changes:** the app container runs
  `pnpm install` on every start, so `docker compose restart app` picks up new
  deps; if you changed the `Dockerfile` itself, use
  `docker compose up -d --build app`.
- **Run any command inside the app container:** `docker compose exec app <command>`
  (e.g. `pnpm check`, `pnpm seed:restore`).
- **Stop containers:** `docker compose down`
- **Stop containers and delete volumes (wipes local data):** `docker compose down -v`

## 🤝 Contributing

We welcome contributions! Please feel free to submit issues and pull requests.

### Development Guidelines

- Follow TypeScript best practices.
- Use Prettier for code formatting.
- Write meaningful commit messages.
- Test your changes thoroughly.

## ⭐ Stargazers Over Time

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="static/star-history/star-history-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="static/star-history/star-history-light.svg">
  <img alt="Stargazers over time" src="static/star-history/star-history.png">
</picture>

## 📄 License

This project is open source and available under the [Mozilla Public License 2.0](LICENSE).
