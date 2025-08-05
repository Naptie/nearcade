![nearcade](https://socialify.git.ci/Naptie/nearcade/image?font=Raleway&forks=1&issues=1&language=1&name=1&owner=1&pattern=Circuit+Board&pulls=1&stargazers=1&theme=Auto)

[中文](README.md) | **English**

A modern web application that helps gamers discover arcade gaming venues. Find the best spots to play popular rhythm games like maimai DX, CHUNITHM, SOUND VOLTEX, and more!

Please join the following QQ group for discussions.

<img src="static/group-chat-qq.jpg" alt="QR code for the nearcade QQ group" width="350"/>

## ✨ Features

### 🎯 Location-Based Discovery

- **My Location**: Use GPS to find arcades near your current position
- **University Search**: Search for arcades near specific universities and campuses
- **Map Selection**: Pick any location on an interactive map
- **Customizable Radius**: Search within 1~30 km radius

### 🏆 Campus Rankings

- Compare universities by arcade density and machine availability
- Metrics include shop count, total machines, and area density (machines per km²)
- Game-specific rankings for popular titles
- Daily data updates with 24-hour cache refresh

### 🎮 Game Support

- maimai DX
- CHUNITHM
- Taiko no Tatsujin
- SOUND VOLTEX
- WACCA

## 🛠️ Technical Stack

### Frontend Framework

- **SvelteKit**: Full-stack framework with SSR/SPA capabilities
- **Svelte 5**: Latest version with enhanced reactivity system
- **TypeScript**: Type-safe development throughout

### Styling & UI

- **Tailwind CSS 4.0**: Utility-first CSS framework
- **daisyUI**: Semantic component classes for Tailwind
- **Font Awesome**: Comprehensive icon library

### Backend & Database

- **MongoDB**: Document database for storing arcade and university data
- **Server-side API**: RESTful endpoints built with SvelteKit

### Maps & Location Services

- **高德地图 (AMap) & 腾讯地图 (Tencent Maps)**: Mapping service integration
- **Geolocation API**: Browser-based location detection

### Internationalization

- **Paraglide.js**: Type-safe i18n solution
- **Message-based Translation**: Structured translation system

### Development Tools

- **Vite**: Fast build tool and development server
- **ESLint**: Code linting with Svelte-specific rules
- **Prettier**: Code formatting with plugin support
- **pnpm**: Fast, disk space efficient package manager

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- pnpm (recommended) or npm
- MongoDB instance
- AMap JS API key & secret
- Tencent Maps API key
- Sentry

### Installation

1. **Clone the repository:**

   ```bash
   git clone https://github.com/Naptie/nearcade.git
   cd nearcade
   ```

2. **Install dependencies:**

   ```bash
   pnpm install
   ```

3. **Set up environment variables:**

   Create a `.env` file in the root directory:

   ```env
   PUBLIC_AMAP_KEY = "your_key"
   PUBLIC_QQMAP_KEY = "your_key"
   PUBLIC_SENTRY_DSN = "https://example.ingest.de.sentry.io/"

   AMAP_SECRET = "your_secret"
   MONGODB_URI = "mongodb://localhost:27017/?dbName=nearcade"
   ```

   Additionally, if you need to generate a static build, set the `PUBLIC_API_BASE` environment variable (and delete all `+page.server.ts` files); if you want to publish a Sentry release or upload source maps to Sentry, set the `SENTRY_AUTH_TOKEN` environment variable.

4. **Start development server:**

   ```bash
   pnpm dev
   ```

5. **Open your browser:**
   Navigate to `http://localhost:5173`

### Building for Production

```bash
# Build the application
pnpm build

# Preview the production build
pnpm preview
```

### Deploy to Cloudflare Workers

```bash
ADAPTER=cloudflare pnpm cf-deploy
```

## 🚢 Running with Docker

### Prerequisites

- **Docker** installed on your machine (follow the [installation guide](https://docs.docker.com/get-docker/)).
- **Docker Compose** (for multi-container setups, if needed).

### Step-by-Step Guide

1. **Clone the repository:**

   ```bash
   git clone https://github.com/Naptie/nearcade.git
   cd nearcade
   ```

2. **Build the Docker images:**

   Make sure that both `Dockerfile` and `docker-compose.yml` are in the root directory of your project.

   ```bash
   docker-compose build
   ```

3. **Set up environment variables:**

   Ensure that you have the required environment variables set. You can create a `.env` file in the root of your project directory with the following content:

   ```env
   PUBLIC_AMAP_KEY = "your_key"
   PUBLIC_QQMAP_KEY = "your_key"
   PUBLIC_SENTRY_DSN = "https://example.ingest.de.sentry.io/"

   AMAP_SECRET = "your_secret"
   MONGODB_URI = "mongodb://localhost:27017/?dbName=nearcade"
   ```

   **Note:** If you're using Docker Compose to run the app and MongoDB together, you may need to modify `MONGODB_URI` to point to the MongoDB container instead of `localhost`.

4. **Start the application using Docker Compose:**

   ```bash
   docker-compose up
   ```

   This will start both the application and any dependencies, like MongoDB, that you have defined in your `docker-compose.yml` file.

5. **Access the application:**

   Once the containers are up and running, navigate to `http://localhost:3000` in your browser to view the application.

### Stopping the Docker Containers

To stop the Docker containers, run:

```bash
docker-compose down
```

---

## 🤝 Contributing

We welcome contributions! Please feel free to submit issues and pull requests.

### Development Guidelines

- Follow TypeScript best practices
- Use Prettier for code formatting
- Write meaningful commit messages
- Test your changes thoroughly

## ⭐ Stargazers Over Time

[![Stargazers over time](https://starchart.cc/Naptie/nearcade.svg?variant=adaptive)](https://starchart.cc/Naptie/nearcade)

## 📄 License

This project is open source and available under the [Mozilla Public License 2.0](LICENSE).

## 🙏 Acknowledgments

- [BEMANICN](https://map.bemanicn.com/)
