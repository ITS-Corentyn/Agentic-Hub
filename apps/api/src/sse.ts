import { EventEmitter } from 'node:events';
import type { SseEvent } from '@agentic-hub/shared';

/**
 * Hub SSE en mémoire (l'API tourne en instance unique avec ses workers pg-boss).
 * Publie la progression des audits vers les clients abonnés.
 */
class SseHub extends EventEmitter {
  publish(event: SseEvent) {
    this.emit(event.auditId, event);
    this.emit('*', event);
  }
}

export const sseHub = new SseHub();
sseHub.setMaxListeners(0);
