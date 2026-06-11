import { reactive } from 'vue';

export interface Toast {
  id: number;
  message: string;
  type: 'info' | 'success' | 'error';
}

let seq = 0;
export const toasts = reactive<Toast[]>([]);

/** Affiche une notification temporaire (système global). */
export function toast(message: string, type: Toast['type'] = 'info', ms = 4500): void {
  const id = ++seq;
  toasts.push({ id, message, type });
  setTimeout(() => {
    const i = toasts.findIndex((t) => t.id === id);
    if (i >= 0) toasts.splice(i, 1);
  }, ms);
}
