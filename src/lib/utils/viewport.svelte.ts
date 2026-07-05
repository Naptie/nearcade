import { browser } from '$app/environment';

function createViewport() {
  let windowWidth = $state(browser ? window.innerWidth : 0);

  if (browser) {
    window.addEventListener(
      'resize',
      () => {
        windowWidth = window.innerWidth;
      },
      { passive: true }
    );
  }

  return {
    get width() {
      return windowWidth;
    },
    get sm() {
      return windowWidth >= 640;
    },
    get md() {
      return windowWidth >= 768;
    },
    get lg() {
      return windowWidth >= 1024;
    },
    get xl() {
      return windowWidth >= 1280;
    }
  };
}

export const viewport = createViewport();
