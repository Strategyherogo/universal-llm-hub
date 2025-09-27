import pkg from '@slack/bolt';
const { App, ExpressReceiver } = pkg;
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { Logger } from './services/Logger.js';
import { LLMProviderManager } from './services/LLMProviderManager.js';
import { CommandProcessor } from './services/CommandProcessor.js';
import { ConversationManager } from './services/ConversationManager.js';
import { UserManager } from './services/UserManager.js';
import { AnalyticsService } from './services/AnalyticsService.js';
import { LLMRequest, SlackCommand } from './types/index.js';

export class SlackApp {
  private app: App;
  private expressReceiver: ExpressReceiver;
  private logger: Logger;
  private llmManager: LLMProviderManager;
  private commandProcessor: CommandProcessor;
  private conversationManager: ConversationManager;
  private userManager: UserManager;
  private analytics: AnalyticsService;

  constructor() {
    this.logger = new Logger('SlackApp');
    this.setupExpressReceiver();
    this.setupSlackApp();
    this.initializeServices();
    this.setupEventHandlers();
    this.setupSlashCommands();
    this.setupMiddleware();
  }

  private setupExpressReceiver() {
    this.expressReceiver = new ExpressReceiver({
      signingSecret: process.env.SLACK_SIGNING_SECRET!,
      endpoints: '/slack/events',
      processBeforeResponse: true
    });

    const app = this.expressReceiver.app;

    // Security middleware
    app.use(helmet());
    app.use(cors({
      origin: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3000'],
      credentials: true
    }));
    app.use(compression());

    // Rate limiting
    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: parseInt(process.env.API_RATE_LIMIT || '100'),
      message: 'Too many requests, please try again later'
    });
    app.use('/api/', limiter);

    // Health check endpoints
    app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: process.env.npm_package_version || '1.0.0'
      });
    });

    app.get('/health/detailed', async (req, res) => {
      try {
        const health = {
          status: 'healthy',
          timestamp: new Date().toISOString(),
          services: {
            slack: true,
            redis: await this.conversationManager?.isHealthy() || false,
            providers: {} as Record<string, boolean>
          },
          metrics: {
            uptime: process.uptime(),
            memoryUsage: process.memoryUsage(),
            activeConnections: 0
          }
        };

        // Check LLM providers
        const providers = this.llmManager?.getAvailableProviders() || [];
        for (const provider of providers) {
          health.services.providers[provider.name] = this.llmManager?.isProviderAvailable(provider.type) || false;
        }

        res.json(health);
      } catch (error) {
        res.status(503).json({
          status: 'unhealthy',
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    // Metrics endpoint
    app.get('/metrics', async (req, res) => {
      try {
        const stats = this.llmManager?.getProviderStats() || [];
        const analytics = await this.analytics?.getMetrics() || {};

        res.json({
          providers: stats,
          analytics,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        res.status(500).json({
          error: error instanceof Error ? error.message : 'Failed to get metrics'
        });
      }
    });
  }

  private setupSlackApp() {
    this.app = new App({
      receiver: this.expressReceiver,
      token: process.env.SLACK_BOT_TOKEN!,
      appToken: process.env.SLACK_APP_TOKEN,
      socketMode: false
    });
  }

  private initializeServices() {
    this.llmManager = new LLMProviderManager();
    this.conversationManager = new ConversationManager();
    this.userManager = new UserManager();
    this.analytics = new AnalyticsService();
    this.commandProcessor = new CommandProcessor(
      this.llmManager,
      this.conversationManager,
      this.userManager,
      this.analytics
    );
  }

  private setupEventHandlers() {
    // Handle direct messages and mentions
    this.app.event('message', async ({ event, client, say }) => {
      try {
        // Skip bot messages and messages without text
        if (event.subtype === 'bot_message' || !('text' in event) || !event.text) return;

        const isDirectMessage = event.channel_type === 'im';
        const isMention = event.text.includes(`<@${process.env.SLACK_BOT_USER_ID}>`);

        if (isDirectMessage || isMention) {
          await this.handleMessage(event, client, say);
        }
      } catch (error) {
        this.logger.error('Error handling message event', { error, event: event.type });
      }
    });

    // Handle file uploads
    this.app.event('file_shared', async ({ event, client }) => {
      try {
        await this.handleFileUpload(event, client);
      } catch (error) {
        this.logger.error('Error handling file upload', { error, fileId: event.file_id });
      }
    });

    // Handle app mentions
    this.app.event('app_mention', async ({ event, client, say }) => {
      try {
        await this.handleMessage(event, client, say);
      } catch (error) {
        this.logger.error('Error handling app mention', { error, event: event.type });
      }
    });
  }

  private setupSlashCommands() {
    // Main AI command
    this.app.command('/ai', async ({ command, ack, respond, client }) => {
      await ack();
      try {
        await this.handleSlashCommand(command, respond, client, 'ask');
      } catch (error) {
        this.logger.error('Error handling /ai command', { error, userId: command.user_id });
        await respond('Sorry, something went wrong. Please try again.');
      }
    });

    // Provider-specific commands
    this.app.command('/ai-gpt4', async ({ command, ack, respond, client }) => {
      await ack();
      try {
        await this.handleSlashCommand(command, respond, client, 'ask', 'openai', 'gpt-4');
      } catch (error) {
        this.logger.error('Error handling /ai-gpt4 command', { error, userId: command.user_id });
        await respond('Sorry, something went wrong. Please try again.');
      }
    });

    this.app.command('/ai-claude', async ({ command, ack, respond, client }) => {
      await ack();
      try {
        await this.handleSlashCommand(command, respond, client, 'ask', 'anthropic', 'claude-3-5-sonnet-20241022');
      } catch (error) {
        this.logger.error('Error handling /ai-claude command', { error, userId: command.user_id });
        await respond('Sorry, something went wrong. Please try again.');
      }
    });

    this.app.command('/ai-groq', async ({ command, ack, respond, client }) => {
      await ack();
      try {
        await this.handleSlashCommand(command, respond, client, 'ask', 'groq', 'llama-3.1-70b-versatile');
      } catch (error) {
        this.logger.error('Error handling /ai-groq command', { error, userId: command.user_id });
        await respond('Sorry, something went wrong. Please try again.');
      }
    });

    // Utility commands
    this.app.command('/ai-compare', async ({ command, ack, respond, client }) => {
      await ack();
      try {
        await this.handleSlashCommand(command, respond, client, 'compare');
      } catch (error) {
        this.logger.error('Error handling /ai-compare command', { error, userId: command.user_id });
        await respond('Sorry, something went wrong. Please try again.');
      }
    });

    this.app.command('/ai-providers', async ({ command, ack, respond }) => {
      await ack();
      try {
        const providers = this.llmManager.getAvailableProviders();
        const stats = this.llmManager.getProviderStats();

        let message = '*Available AI Providers:*\\n\\n';

        providers.forEach(provider => {
          const providerStats = stats.find(s => s.provider === provider.type);
          const status = this.llmManager.isProviderAvailable(provider.type) ? '🟢' : '🔴';

          message += `${status} *${provider.name}*\\n`;
          message += `   Models: ${provider.models.join(', ')}\\n`;
          message += `   Cost: $${provider.pricing.inputTokens}/1K input, $${provider.pricing.outputTokens}/1K output\\n`;

          if (providerStats) {
            message += `   Avg Latency: ${providerStats.stats.averageLatency.toFixed(0)}ms\\n`;
            message += `   Success Rate: ${(providerStats.stats.successRate * 100).toFixed(1)}%\\n`;
          }

          message += '\\n';
        });

        await respond(message);
      } catch (error) {
        this.logger.error('Error handling /ai-providers command', { error, userId: command.user_id });
        await respond('Sorry, failed to get provider information.');
      }
    });

    this.app.command('/ai-usage', async ({ command, ack, respond }) => {
      await ack();
      try {
        const subscription = await this.userManager.getUserSubscription(command.user_id, command.team_id);

        if (!subscription) {
          await respond('No subscription found. Use `/ai-subscribe` to get started.');
          return;
        }

        const usagePercent = (subscription.usage.requestsThisMonth / subscription.limits.monthlyRequests) * 100;

        let message = `*Your AI Usage This Month:*\\n\\n`;
        message += `Requests: ${subscription.usage.requestsThisMonth}/${subscription.limits.monthlyRequests} (${usagePercent.toFixed(1)}%)\\n`;
        message += `Tokens: ${subscription.usage.tokensThisMonth.toLocaleString()}\\n`;
        message += `Cost: $${subscription.usage.costThisMonth.toFixed(2)}\\n`;
        message += `Plan: ${subscription.tier}\\n`;
        message += `Status: ${subscription.status}\\n`;

        await respond(message);
      } catch (error) {
        this.logger.error('Error handling /ai-usage command', { error, userId: command.user_id });
        await respond('Sorry, failed to get usage information.');
      }
    });
  }

  private setupMiddleware() {
    this.app.use(async ({ payload, next }) => {
      try {
        await next();
      } catch (error) {
        this.logger.error('Middleware error', { error, payload: payload.type });
      }
    });
  }

  private async handleMessage(event: any, client: any, say: any) {
    const startTime = Date.now();

    try {
      // Extract message text and clean it
      let text = event.text || '';
      if (text.includes(`<@${process.env.SLACK_BOT_USER_ID}>`)) {
        text = text.replace(/<@[A-Z0-9]+>/g, '').trim();
      }

      if (!text) {
        await say('Hello! I can help you with AI-powered tasks. Try asking me a question or use `/ai` command.');
        return;
      }

      // Check user subscription
      const subscription = await this.userManager.getUserSubscription(event.user, event.team || 'default');
      if (!subscription || subscription.status !== 'active') {
        await say('Please subscribe to use AI features. Use `/ai-subscribe` to get started.');
        return;
      }

      // Check rate limits
      if (subscription.usage.requestsThisMonth >= subscription.limits.monthlyRequests) {
        await say('You\'ve reached your monthly request limit. Please upgrade your plan.');
        return;
      }

      // Get conversation context
      const context = await this.conversationManager.getContext(event.user, event.channel);

      // Create LLM request
      const request: LLMRequest = {
        id: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        userId: event.user,
        teamId: event.team || 'default',
        prompt: text,
        context,
        options: {
          maxTokens: subscription.limits.maxTokensPerRequest,
          temperature: 0.7
        },
        priority: 'normal',
        metadata: {
          command: 'message',
          channel: event.channel,
          timestamp: new Date()
        }
      };

      // Show typing indicator
      await say('🤔 Thinking...');

      // Process request
      const response = await this.llmManager.processRequest(request);

      // Update conversation context
      await this.conversationManager.addMessage(event.user, event.channel, {
        role: 'user',
        content: text,
        timestamp: new Date()
      });

      await this.conversationManager.addMessage(event.user, event.channel, {
        role: 'assistant',
        content: response.content,
        timestamp: new Date(),
        provider: response.provider,
        model: response.model,
        tokens: response.usage.totalTokens
      });

      // Update usage
      await this.userManager.updateUsage(event.user, event.team || 'default', {
        requests: 1,
        tokens: response.usage.totalTokens,
        cost: response.usage.cost
      });

      // Track analytics
      await this.analytics.track({
        id: response.id,
        type: 'message_processed',
        userId: event.user,
        teamId: event.team || 'default',
        timestamp: new Date(),
        data: {
          provider: response.provider,
          model: response.model,
          tokens: response.usage.totalTokens,
          latency: response.performance.latency
        },
        cost: response.usage.cost,
        success: true
      });

      // Format and send response
      let formattedResponse = response.content;

      // Add provider info footer
      const processingTime = Date.now() - startTime;
      formattedResponse += `\\n\\n_Powered by ${response.provider}/${response.model} • ${response.usage.totalTokens} tokens • ${processingTime}ms • $${response.usage.cost.toFixed(4)}_`;

      await say(formattedResponse);

    } catch (error) {
      this.logger.error('Error processing message', { error, userId: event.user });
      await say('Sorry, I encountered an error processing your request. Please try again.');
    }
  }

  private async handleSlashCommand(
    command: any,
    respond: any,
    client: any,
    type: string,
    provider?: string,
    model?: string
  ) {
    const slackCommand: SlackCommand = {
      type: type as any,
      provider,
      model,
      prompt: command.text,
      options: {}
    };

    const result = await this.commandProcessor.processCommand(
      slackCommand,
      command.user_id,
      command.team_id,
      command.channel_id
    );

    await respond(result.message);
  }

  private async handleFileUpload(event: any, client: any) {
    // TODO: Implement file analysis
    this.logger.info('File uploaded', { fileId: event.file_id, userId: event.user_id });
  }

  async start() {
    const port = parseInt(process.env.SLACK_PORT || '3000');

    try {
      await this.app.start(port);
      this.logger.info(`Universal LLM Slack Hub started on port ${port}`);

      // Log available providers
      const providers = this.llmManager.getAvailableProviders();
      this.logger.info(`Initialized with ${providers.length} LLM providers`, {
        providers: providers.map(p => p.name)
      });

    } catch (error) {
      this.logger.error('Failed to start application', { error });
      throw error;
    }
  }

  async stop() {
    try {
      await this.app.stop();
      this.logger.info('Application stopped');
    } catch (error) {
      this.logger.error('Error stopping application', { error });
    }
  }
}