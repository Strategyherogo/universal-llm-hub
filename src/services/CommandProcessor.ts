import { Logger } from './Logger.js';
import { LLMProviderManager } from './LLMProviderManager.js';
import { ConversationManager } from './ConversationManager.js';
import { UserManager } from './UserManager.js';
import { AnalyticsService } from './AnalyticsService.js';
import { SlackCommand, LLMRequest } from '../types/index.js';

export class CommandProcessor {
  private logger: Logger;
  private llmManager: LLMProviderManager;
  private conversationManager: ConversationManager;
  private userManager: UserManager;
  private analytics: AnalyticsService;

  constructor(
    llmManager: LLMProviderManager,
    conversationManager: ConversationManager,
    userManager: UserManager,
    analytics: AnalyticsService
  ) {
    this.logger = new Logger('CommandProcessor');
    this.llmManager = llmManager;
    this.conversationManager = conversationManager;
    this.userManager = userManager;
    this.analytics = analytics;
  }

  async processCommand(
    command: SlackCommand,
    userId: string,
    teamId: string,
    channelId: string
  ): Promise<{ message: string; success: boolean }> {
    try {
      // Check user subscription and limits
      const subscription = await this.userManager.getUserSubscription(userId, teamId);
      if (!subscription || subscription.status !== 'active') {
        return {
          message: 'Please subscribe to use AI features. Contact your admin or visit our pricing page.',
          success: false
        };
      }

      if (subscription.usage.requestsThisMonth >= subscription.limits.monthlyRequests) {
        return {
          message: `You've reached your monthly limit of ${subscription.limits.monthlyRequests} requests. Please upgrade your plan.`,
          success: false
        };
      }

      // Process based on command type
      switch (command.type) {
        case 'ask':
          return await this.processAskCommand(command, userId, teamId, channelId);
        case 'compare':
          return await this.processCompareCommand(command, userId, teamId, channelId);
        case 'analyze':
          return await this.processAnalyzeCommand(command, userId, teamId, channelId);
        case 'generate':
          return await this.processGenerateCommand(command, userId, teamId, channelId);
        case 'summarize':
          return await this.processSummarizeCommand(command, userId, teamId, channelId);
        case 'translate':
          return await this.processTranslateCommand(command, userId, teamId, channelId);
        case 'code':
          return await this.processCodeCommand(command, userId, teamId, channelId);
        default:
          return {
            message: 'Unknown command type. Use `/ai help` for available commands.',
            success: false
          };
      }
    } catch (error) {
      this.logger.error('Command processing failed', { error, command: command.type, userId });
      return {
        message: 'Sorry, something went wrong processing your command. Please try again.',
        success: false
      };
    }
  }

  private async processAskCommand(
    command: SlackCommand,
    userId: string,
    teamId: string,
    channelId: string
  ): Promise<{ message: string; success: boolean }> {
    if (!command.prompt.trim()) {
      return {
        message: 'Please provide a question or prompt. Example: `/ai What is the capital of France?`',
        success: false
      };
    }

    const context = await this.conversationManager.getContext(userId, channelId);
    const subscription = await this.userManager.getUserSubscription(userId, teamId);

    const request: LLMRequest = {
      id: `cmd_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      userId,
      teamId,
      provider: command.provider,
      model: command.model,
      prompt: command.prompt,
      context,
      options: {
        maxTokens: subscription!.limits.maxTokensPerRequest,
        temperature: 0.7,
        systemPrompt: 'You are a helpful AI assistant. Provide clear, accurate, and concise responses.'
      },
      priority: 'normal',
      metadata: {
        command: 'ask',
        channel: channelId,
        timestamp: new Date()
      }
    };

    const response = await this.llmManager.processRequest(request);

    // Update conversation and usage
    await this.updateConversationAndUsage(userId, teamId, channelId, request.prompt, response);

    return {
      message: this.formatResponse(response),
      success: true
    };
  }

  private async processCompareCommand(
    command: SlackCommand,
    userId: string,
    teamId: string,
    channelId: string
  ): Promise<{ message: string; success: boolean }> {
    if (!command.prompt.trim()) {
      return {
        message: 'Please provide a prompt to compare across models. Example: `/ai-compare Explain quantum computing`',
        success: false
      };
    }

    const providers = ['openai', 'anthropic', 'groq'];
    const models = ['gpt-4', 'claude-3-5-sonnet-20241022', 'llama-3.1-70b-versatile'];
    const responses: any[] = [];

    const subscription = await this.userManager.getUserSubscription(userId, teamId);
    const baseRequest: Omit<LLMRequest, 'provider' | 'model'> = {
      id: '',
      userId,
      teamId,
      prompt: command.prompt,
      options: {
        maxTokens: Math.min(500, subscription!.limits.maxTokensPerRequest),
        temperature: 0.7
      },
      priority: 'normal',
      metadata: {
        command: 'compare',
        channel: channelId,
        timestamp: new Date()
      }
    };

    // Run requests in parallel
    const promises = providers.map(async (provider, index) => {
      if (!this.llmManager.isProviderAvailable(provider)) return null;

      try {
        const request: LLMRequest = {
          ...baseRequest,
          id: `comp_${Date.now()}_${index}`,
          provider,
          model: models[index]
        };

        const response = await this.llmManager.processRequest(request);
        return { provider, model: models[index], response };
      } catch (error) {
        this.logger.warn(`Comparison failed for ${provider}`, { error });
        return null;
      }
    });

    const results = await Promise.all(promises);
    const validResults = results.filter(r => r !== null);

    if (validResults.length === 0) {
      return {
        message: 'No providers available for comparison. Please try again later.',
        success: false
      };
    }

    // Format comparison response
    let message = `*Comparison Results for: "${command.prompt}"*\\n\\n`;

    validResults.forEach(result => {
      message += `*${result!.response.provider}/${result!.response.model}*\\n`;
      message += `${result!.response.content.substring(0, 300)}${result!.response.content.length > 300 ? '...' : ''}\\n`;
      message += `_${result!.response.usage.totalTokens} tokens • ${result!.response.performance.latency}ms • $${result!.response.usage.cost.toFixed(4)}_\\n\\n`;
    });

    // Update usage for all successful requests
    const totalTokens = validResults.reduce((sum, r) => sum + r!.response.usage.totalTokens, 0);
    const totalCost = validResults.reduce((sum, r) => sum + r!.response.usage.cost, 0);

    await this.userManager.updateUsage(userId, teamId, {
      requests: validResults.length,
      tokens: totalTokens,
      cost: totalCost
    });

    return {
      message,
      success: true
    };
  }

  private async processAnalyzeCommand(
    command: SlackCommand,
    userId: string,
    teamId: string,
    channelId: string
  ): Promise<{ message: string; success: boolean }> {
    const context = await this.conversationManager.getContext(userId, channelId);
    const subscription = await this.userManager.getUserSubscription(userId, teamId);

    const analyzePrompt = `Analyze the following content in detail. Provide insights, key points, and actionable recommendations:\\n\\n${command.prompt}`;

    const request: LLMRequest = {
      id: `analyze_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      userId,
      teamId,
      provider: command.provider || 'anthropic', // Claude is excellent for analysis
      model: command.model || 'claude-3-5-sonnet-20241022',
      prompt: analyzePrompt,
      context,
      options: {
        maxTokens: subscription!.limits.maxTokensPerRequest,
        temperature: 0.3, // Lower temperature for more focused analysis
        systemPrompt: 'You are an expert analyst. Provide structured, insightful analysis with clear recommendations.'
      },
      priority: 'normal',
      metadata: {
        command: 'analyze',
        channel: channelId,
        timestamp: new Date()
      }
    };

    const response = await this.llmManager.processRequest(request);
    await this.updateConversationAndUsage(userId, teamId, channelId, analyzePrompt, response);

    return {
      message: this.formatResponse(response, '📊 Analysis Complete'),
      success: true
    };
  }

  private async processGenerateCommand(
    command: SlackCommand,
    userId: string,
    teamId: string,
    channelId: string
  ): Promise<{ message: string; success: boolean }> {
    const context = await this.conversationManager.getContext(userId, channelId);
    const subscription = await this.userManager.getUserSubscription(userId, teamId);

    const generatePrompt = `Generate creative content based on this request: ${command.prompt}`;

    const request: LLMRequest = {
      id: `gen_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      userId,
      teamId,
      provider: command.provider || 'openai', // GPT-4 excels at creative generation
      model: command.model || 'gpt-4',
      prompt: generatePrompt,
      context,
      options: {
        maxTokens: subscription!.limits.maxTokensPerRequest,
        temperature: 0.8, // Higher temperature for creativity
        systemPrompt: 'You are a creative writing assistant. Generate engaging, original content that meets the user\'s specifications.'
      },
      priority: 'normal',
      metadata: {
        command: 'generate',
        channel: channelId,
        timestamp: new Date()
      }
    };

    const response = await this.llmManager.processRequest(request);
    await this.updateConversationAndUsage(userId, teamId, channelId, generatePrompt, response);

    return {
      message: this.formatResponse(response, '✨ Generated Content'),
      success: true
    };
  }

  private async processSummarizeCommand(
    command: SlackCommand,
    userId: string,
    teamId: string,
    channelId: string
  ): Promise<{ message: string; success: boolean }> {
    const context = await this.conversationManager.getContext(userId, channelId);
    const subscription = await this.userManager.getUserSubscription(userId, teamId);

    const summarizePrompt = `Provide a concise summary of the following content, highlighting the key points and main takeaways:\\n\\n${command.prompt}`;

    const request: LLMRequest = {
      id: `sum_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      userId,
      teamId,
      provider: command.provider || 'anthropic',
      model: command.model || 'claude-3-5-sonnet-20241022',
      prompt: summarizePrompt,
      context,
      options: {
        maxTokens: Math.min(500, subscription!.limits.maxTokensPerRequest),
        temperature: 0.3,
        systemPrompt: 'You are an expert at creating clear, concise summaries. Focus on the most important information.'
      },
      priority: 'normal',
      metadata: {
        command: 'summarize',
        channel: channelId,
        timestamp: new Date()
      }
    };

    const response = await this.llmManager.processRequest(request);
    await this.updateConversationAndUsage(userId, teamId, channelId, summarizePrompt, response);

    return {
      message: this.formatResponse(response, '📋 Summary'),
      success: true
    };
  }

  private async processTranslateCommand(
    command: SlackCommand,
    userId: string,
    teamId: string,
    channelId: string
  ): Promise<{ message: string; success: boolean }> {
    const subscription = await this.userManager.getUserSubscription(userId, teamId);

    // Extract target language from command
    const parts = command.prompt.split(' ');
    const targetLang = parts[0];
    const textToTranslate = parts.slice(1).join(' ');

    if (!textToTranslate) {
      return {
        message: 'Please specify target language and text. Example: `/ai-translate spanish Hello, how are you?`',
        success: false
      };
    }

    const translatePrompt = `Translate the following text to ${targetLang}: ${textToTranslate}`;

    const request: LLMRequest = {
      id: `trans_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      userId,
      teamId,
      provider: command.provider || 'openai',
      model: command.model || 'gpt-4',
      prompt: translatePrompt,
      options: {
        maxTokens: subscription!.limits.maxTokensPerRequest,
        temperature: 0.2,
        systemPrompt: 'You are a professional translator. Provide accurate translations that preserve meaning and context.'
      },
      priority: 'normal',
      metadata: {
        command: 'translate',
        channel: channelId,
        timestamp: new Date()
      }
    };

    const response = await this.llmManager.processRequest(request);
    await this.updateConversationAndUsage(userId, teamId, channelId, translatePrompt, response);

    return {
      message: this.formatResponse(response, '🌐 Translation'),
      success: true
    };
  }

  private async processCodeCommand(
    command: SlackCommand,
    userId: string,
    teamId: string,
    channelId: string
  ): Promise<{ message: string; success: boolean }> {
    const context = await this.conversationManager.getContext(userId, channelId);
    const subscription = await this.userManager.getUserSubscription(userId, teamId);

    const codePrompt = `Help with this coding task: ${command.prompt}`;

    const request: LLMRequest = {
      id: `code_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      userId,
      teamId,
      provider: command.provider || 'openai',
      model: command.model || 'gpt-4',
      prompt: codePrompt,
      context,
      options: {
        maxTokens: subscription!.limits.maxTokensPerRequest,
        temperature: 0.1, // Very low temperature for code accuracy
        systemPrompt: 'You are an expert programmer. Provide clean, well-commented code with explanations.'
      },
      priority: 'normal',
      metadata: {
        command: 'code',
        channel: channelId,
        timestamp: new Date()
      }
    };

    const response = await this.llmManager.processRequest(request);
    await this.updateConversationAndUsage(userId, teamId, channelId, codePrompt, response);

    return {
      message: this.formatResponse(response, '💻 Code Solution'),
      success: true
    };
  }

  private async updateConversationAndUsage(
    userId: string,
    teamId: string,
    channelId: string,
    prompt: string,
    response: any
  ) {
    // Update conversation
    await this.conversationManager.addMessage(userId, channelId, {
      role: 'user',
      content: prompt,
      timestamp: new Date()
    });

    await this.conversationManager.addMessage(userId, channelId, {
      role: 'assistant',
      content: response.content,
      timestamp: new Date(),
      provider: response.provider,
      model: response.model,
      tokens: response.usage.totalTokens
    });

    // Update usage
    await this.userManager.updateUsage(userId, teamId, {
      requests: 1,
      tokens: response.usage.totalTokens,
      cost: response.usage.cost
    });

    // Track analytics
    await this.analytics.track({
      id: response.id,
      type: 'command_processed',
      userId,
      teamId,
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
  }

  private formatResponse(response: any, title?: string): string {
    let message = '';

    if (title) {
      message += `*${title}*\\n\\n`;
    }

    message += response.content;

    // Add footer with provider info
    message += `\\n\\n_Powered by ${response.provider}/${response.model} • ${response.usage.totalTokens} tokens • ${response.performance.latency}ms • $${response.usage.cost.toFixed(4)}_`;

    return message;
  }
}