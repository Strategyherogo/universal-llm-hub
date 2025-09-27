import { Logger } from './Logger.js';
import { AnalyticsEvent } from '../types/index.js';

export class AnalyticsService {
  private logger: Logger;
  private events: AnalyticsEvent[] = [];

  constructor() {
    this.logger = new Logger('AnalyticsService');
  }

  async track(event: AnalyticsEvent): Promise<void> {
    try {
      this.events.push(event);

      // Keep only last 1000 events in memory for MVP
      if (this.events.length > 1000) {
        this.events = this.events.slice(-1000);
      }

      this.logger.debug('Event tracked', { eventId: event.id, type: event.type });
    } catch (error) {
      this.logger.error('Failed to track event', { error, eventId: event.id });
    }
  }

  async getMetrics(): Promise<any> {
    try {
      const last24h = this.events.filter(e =>
        Date.now() - e.timestamp.getTime() < 24 * 60 * 60 * 1000
      );

      return {
        totalEvents: this.events.length,
        last24h: last24h.length,
        totalCost: this.events.reduce((sum, e) => sum + (e.cost || 0), 0),
        successRate: this.events.filter(e => e.success).length / Math.max(this.events.length, 1)
      };
    } catch (error) {
      this.logger.error('Failed to get metrics', { error });
      return {};
    }
  }
}