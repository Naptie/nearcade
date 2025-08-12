/**
 * Client-side PWA push notification manager
 */

export interface PushNotificationData {
  title: string;
  body: string;
  data?: {
    postId?: string;
    commentId?: string;
    universityId?: string;
    clubId?: string;
    url?: string;
  };
  tag?: string;
}

class PushNotificationManager {
  private registration: ServiceWorkerRegistration | null = null;

  async init(): Promise<void> {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      console.warn('Push notifications are not supported');
      return;
    }

    try {
      this.registration = await navigator.serviceWorker.ready;
      console.log('Service Worker ready for push notifications');
    } catch (error) {
      console.error('Failed to initialize push notification manager:', error);
    }
  }

  async requestPermission(): Promise<NotificationPermission> {
    if (!('Notification' in window)) {
      console.warn('Notifications are not supported');
      return 'denied';
    }

    let permission = Notification.permission;

    if (permission === 'default') {
      permission = await Notification.requestPermission();
    }

    return permission;
  }

  async subscribe(): Promise<PushSubscription | null> {
    if (!this.registration) {
      console.error('Service worker not ready');
      return null;
    }

    const permission = await this.requestPermission();
    if (permission !== 'granted') {
      console.warn('Push notification permission denied');
      return null;
    }

    try {
      // Check if already subscribed
      let subscription = await this.registration.pushManager.getSubscription();

      if (!subscription) {
        // Subscribe to push notifications
        // Note: In a real implementation, you would need a VAPID key from your server
        // For now, this is a placeholder
        subscription = await this.registration.pushManager.subscribe({
          userVisibleOnly: true
          // applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
        });
      }

      return subscription;
    } catch (error) {
      console.error('Failed to subscribe to push notifications:', error);
      return null;
    }
  }

  async unsubscribe(): Promise<boolean> {
    if (!this.registration) {
      return false;
    }

    try {
      const subscription = await this.registration.pushManager.getSubscription();
      if (subscription) {
        await subscription.unsubscribe();
      }
      return true;
    } catch (error) {
      console.error('Failed to unsubscribe from push notifications:', error);
      return false;
    }
  }

  async showNotification(data: PushNotificationData): Promise<void> {
    if (!this.registration) {
      console.error('Service worker not ready');
      return;
    }

    const permission = await this.requestPermission();
    if (permission !== 'granted') {
      return;
    }

    const options: NotificationOptions = {
      body: data.body,
      icon: '/logo-192.webp',
      badge: '/logo-192.webp',
      data: data.data || {},
      tag: data.tag || `notification-${Date.now()}`,
      requireInteraction: false,
      silent: false
    };

    await this.registration.showNotification(data.title, options);
  }

  isSupported(): boolean {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }

  getPermission(): NotificationPermission {
    return Notification.permission;
  }
}

export const pushNotificationManager = new PushNotificationManager();
