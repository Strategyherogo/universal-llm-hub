import Redis from 'ioredis';
import { Logger } from './Logger.js';
import { ConversationContext, ConversationMessage } from '../types/index.js';

export class ConversationManager {
  private redis: Redis;
  private logger: Logger;
  private readonly TTL = 7 * 24 * 60 * 60; // 7 days

  constructor() {
    this.logger = new Logger('ConversationManager');
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB || '0'),
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3
    });
  }

  async getContext(userId: string, channelId: string): Promise<ConversationContext | undefined> {
    try {
      const key = `conversation:${userId}:${channelId}`;
      const data = await this.redis.get(key);

      if (!data) return undefined;

      const context: ConversationContext = JSON.parse(data);
      context.messages = context.messages.map(msg => ({
        ...msg,
        timestamp: new Date(msg.timestamp)
      }));

      return context;
    } catch (error) {
      this.logger.error('Failed to get conversation context', { error, userId, channelId });
      return undefined;
    }
  }

  async addMessage(userId: string, channelId: string, message: ConversationMessage): Promise<void> {
    try {
      const key = `conversation:${userId}:${channelId}`;
      let context = await this.getContext(userId, channelId);

      if (!context) {
        context = {
          conversationId: `${userId}:${channelId}`,
          messages: [],
          totalTokens: 0,
          createdAt: new Date(),
          lastUpdatedAt: new Date()
        };
      }

      context.messages.push(message);
      context.totalTokens += message.tokens || 0;
      context.lastUpdatedAt = new Date();

      // Keep only last 20 messages to manage memory
      if (context.messages.length > 20) {
        context.messages = context.messages.slice(-20);
      }

      await this.redis.setex(key, this.TTL, JSON.stringify(context));
    } catch (error) {
      this.logger.error('Failed to add message to conversation', { error, userId, channelId });
    }
  }

  async clearContext(userId: string, channelId: string): Promise<void> {
    try {
      const key = `conversation:${userId}:${channelId}`;
      await this.redis.del(key);
    } catch (error) {
      this.logger.error('Failed to clear conversation context', { error, userId, channelId });
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.redis.ping();
      return true;
    } catch {
      return false;
    }
  }
}