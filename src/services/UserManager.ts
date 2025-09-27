import { Logger } from './Logger.js';
import { UserSubscription } from '../types/index.js';

export class UserManager {
  private logger: Logger;
  private subscriptions: Map<string, UserSubscription> = new Map();

  constructor() {
    this.logger = new Logger('UserManager');
    this.initializeDefaultSubscriptions();
  }

  private initializeDefaultSubscriptions() {
    // For MVP, provide generous free tier
    const defaultSubscription: UserSubscription = {
      userId: '',
      teamId: '',
      tier: 'free',
      limits: {
        monthlyRequests: 100,
        maxTokensPerRequest: 4000,
        providers: ['openai', 'anthropic', 'groq'],
        features: ['basic_chat', 'commands']
      },
      usage: {
        requestsThisMonth: 0,
        tokensThisMonth: 0,
        costThisMonth: 0
      },
      status: 'active',
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    };

    this.subscriptions.set('default', defaultSubscription);
  }

  async getUserSubscription(userId: string, teamId: string): Promise<UserSubscription | null> {
    try {
      const key = `${teamId}:${userId}`;
      let subscription = this.subscriptions.get(key);

      if (!subscription) {
        // Create default subscription for new users
        subscription = {
          ...this.subscriptions.get('default')!,
          userId,
          teamId
        };
        this.subscriptions.set(key, subscription);
      }

      return subscription;
    } catch (error) {
      this.logger.error('Failed to get user subscription', { error, userId, teamId });
      return null;
    }
  }

  async updateUsage(userId: string, teamId: string, usage: { requests: number; tokens: number; cost: number }): Promise<void> {
    try {
      const key = `${teamId}:${userId}`;
      const subscription = this.subscriptions.get(key);

      if (subscription) {
        subscription.usage.requestsThisMonth += usage.requests;
        subscription.usage.tokensThisMonth += usage.tokens;
        subscription.usage.costThisMonth += usage.cost;
        this.subscriptions.set(key, subscription);
      }
    } catch (error) {
      this.logger.error('Failed to update usage', { error, userId, teamId });
    }
  }
}