import { onUnmounted, ref } from 'vue';

export interface SseMessage {
  type: 'status' | 'log' | 'done' | 'error';
  auditId: string;
  status?: string;
  message?: string;
  progress?: number;
}

/** Abonnement SSE à la progression d'un audit. */
export function useSse(url: string, onMessage: (msg: SseMessage) => void) {
  const connected = ref(false);
  const source = new EventSource(url, { withCredentials: true });

  source.onopen = () => (connected.value = true);
  source.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data) as SseMessage;
      if (data && data.type) onMessage(data);
    } catch {
      /* ping */
    }
  };
  source.onerror = () => (connected.value = false);

  const close = () => source.close();
  onUnmounted(close);

  return { connected, close };
}
