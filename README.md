# nearcade 🕹️

A modern web application that helps gamers discover arcade gaming venues. Find the best spots to play popular rhythm games like maimai DX, CHUNITHM, SOUND VOLTEX, and more!

Please join the following QQ group for discussions.

<img src="static/group-chat-qq.jpg" alt="QR code for the nearcade QQ group" width="350"/>

## ✨ Features

### 🎯 Location-Based Discovery

- **My Location**: Use GPS to find arcades near your current position
- **University Search**: Search for arcades near specific universities and campuses
- **Map Selection**: Pick any location on an interactive map
- **Customizable Radius**: Search within 1-30km radius

### 🏆 University Rankings

- Compare universities by arcade density and machine availability
- Metrics include shop count, total machines, and area density (machines per km²)
- Game-specific rankings for popular titles
- Real-time data with automatic cache refresh

### 🎮 Game Support

- **maimai DX**: SEGA's popular touch-screen rhythm game
- **CHUNITHM**: Air-based rhythm game experience
- **Taiko no Tatsujin**: Traditional Japanese drum rhythm game
- **SOUND VOLTEX**: Electronic music rhythm game with analog controls
- **WACCA**: 360-degree touch panel rhythm game

### 🌐 Internationalization

- Full bilingual support (English/Chinese)
- Localized content and interface
- Built with Paraglide.js for type-safe translations

### 📱 Modern UI/UX

- Responsive design for all devices
- Dark/light mode support
- Interactive maps with AMap integration
- Smooth animations and transitions
- Tailwind CSS with daisyUI components

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
- **Runtime Language Switching**: Dynamic locale changes

### Development Tools

- **Vite**: Fast build tool and development server
- **ESLint**: Code linting with Svelte-specific rules
- **Prettier**: Code formatting with plugin support
- **PNPM**: Fast, disk space efficient package manager

## 🏗️ Project Structure

```
nearcade/
├── src/
│   ├── lib/
│   │   ├── components/          # Reusable Svelte components
│   │   │   ├── DonationModal.svelte
│   │   │   ├── FancyButton.svelte
│   │   │   ├── Footer.svelte
│   │   │   ├── LocaleSwitch.svelte
│   │   │   └── ...
│   │   ├── paraglide/          # Generated i18n files
│   │   ├── constants.ts        # App constants (games, radius options)
│   │   ├── types.ts           # TypeScript type definitions
│   │   └── utils.ts           # Utility functions
│   ├── routes/
│   │   ├── (main)/            # Main application pages
│   │   │   ├── discover/      # Location-based discovery
│   │   │   └── rankings/      # University rankings
│   │   ├── api/               # Server-side API endpoints
│   │   │   ├── shops/         # Arcade shop data
│   │   │   ├── universities/  # University data
│   │   │   └── rankings/      # Ranking calculations
│   │   └── +page.svelte       # Homepage
│   ├── params/                # Route parameter matchers
│   └── app.html              # Main HTML template
├── messages/                  # Translation files
│   ├── en.json               # English translations
│   └── zh.json               # Chinese translations
├── static/                   # Static assets
└── project.inlang/          # i18n project configuration
```

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- PNPM (recommended) or npm
- MongoDB instance
- AMap API key & Tencent Maps API key

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
   AMAP_SECRET = "your_secret"
   MONGODB_URI = "mongodb://localhost:27017/?dbName=nearcade"
   ```

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

- BEMANICN
