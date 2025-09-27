import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import Groq from 'groq-sdk';
import { Ollama } from 'ollama';
import axios from 'axios';
import { Logger } from './Logger.js';
import {
  LLMProvider,
  LLMRequest,
  LLMResponse,
  SmartRoutingDecision,
  ProviderStats
} from '../types/index.js';

export class LLMProviderManager {
  private providers: Map<string, any> = new Map();
  private providerConfigs: Map<string, LLMProvider> = new Map();
  private logger: Logger;
  private stats: Map<string, ProviderStats> = new Map();

  constructor() {
    this.logger = new Logger('LLMProviderManager');
    this.initializeProviders();
    this.initializeProviderConfigs();
  }

  private initializeProviders() {
    // OpenAI
    if (process.env.OPENAI_API_KEY) {
      this.providers.set('openai', new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
        organization: process.env.OPENAI_ORG_ID
      }));
      this.logger.info('OpenAI provider initialized');
    }

    // Anthropic
    if (process.env.ANTHROPIC_API_KEY) {
      this.providers.set('anthropic', new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY
      }));
      this.logger.info('Anthropic provider initialized');
    }

    // Groq
    if (process.env.GROQ_API_KEY) {
      this.providers.set('groq', new Groq({
        apiKey: process.env.GROQ_API_KEY
      }));
      this.logger.info('Groq provider initialized');
    }

    // Ollama
    if (process.env.OLLAMA_BASE_URL) {
      this.providers.set('ollama', new Ollama({
        host: process.env.OLLAMA_BASE_URL
      }));
      this.logger.info('Ollama provider initialized');
    }

    // Custom endpoints
    this.initializeCustomEndpoints();
  }

  private initializeCustomEndpoints() {
    const customEndpoints = process.env.CUSTOM_LLM_ENDPOINTS;
    if (customEndpoints) {
      const endpoints = customEndpoints.split(',');
      endpoints.forEach(endpoint => {
        const [name, url] = endpoint.split(':');
        if (name && url) {
          this.providers.set(`custom_${name}`, {
            baseURL: url.includes('://') ? url : `http://${url}`,
            type: 'custom'
          });
          this.logger.info(`Custom endpoint ${name} initialized at ${url}`);
        }
      });
    }
  }

  private initializeProviderConfigs() {
    // OpenAI configuration
    this.providerConfigs.set('openai', {
      name: 'OpenAI',
      type: 'openai',
      models: ['gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo', 'gpt-4o', 'gpt-4o-mini'],
      pricing: {
        inputTokens: 0.03,
        outputTokens: 0.06
      },
      capabilities: {
        textGeneration: true,
        codeGeneration: true,
        imageAnalysis: true,
        documentAnalysis: true,
        functionCalling: true,
        streaming: true
      },
      limits: {
        maxTokens: 128000,
        maxRequestsPerMinute: 500,
        maxRequestsPerDay: 10000
      }
    });

    // Anthropic configuration
    this.providerConfigs.set('anthropic', {
      name: 'Anthropic',
      type: 'anthropic',
      models: ['claude-3-5-sonnet-20241022', 'claude-3-haiku-20240307', 'claude-3-opus-20240229'],
      pricing: {
        inputTokens: 0.015,
        outputTokens: 0.075
      },
      capabilities: {
        textGeneration: true,
        codeGeneration: true,
        imageAnalysis: true,
        documentAnalysis: true,
        functionCalling: true,
        streaming: true
      },
      limits: {
        maxTokens: 200000,
        maxRequestsPerMinute: 50,
        maxRequestsPerDay: 1000
      }
    });

    // Groq configuration
    this.providerConfigs.set('groq', {
      name: 'Groq',
      type: 'groq',
      models: ['llama-3.1-405b-reasoning', 'llama-3.1-70b-versatile', 'mixtral-8x7b-32768'],
      pricing: {
        inputTokens: 0.0005,
        outputTokens: 0.0008
      },
      capabilities: {
        textGeneration: true,
        codeGeneration: true,
        imageAnalysis: false,
        documentAnalysis: true,
        functionCalling: true,
        streaming: true
      },
      limits: {
        maxTokens: 32768,
        maxRequestsPerMinute: 30,
        maxRequestsPerDay: 14400
      }
    });

    // Ollama configuration
    this.providerConfigs.set('ollama', {
      name: 'Ollama',
      type: 'ollama',
      models: ['llama2', 'codellama', 'mistral', 'neural-chat'],
      pricing: {
        inputTokens: 0,
        outputTokens: 0
      },
      capabilities: {
        textGeneration: true,
        codeGeneration: true,
        imageAnalysis: false,
        documentAnalysis: true,
        functionCalling: false,
        streaming: true
      },
      limits: {
        maxTokens: 4096,
        maxRequestsPerMinute: 1000,
        maxRequestsPerDay: 100000
      }
    });
  }

  async processRequest(request: LLMRequest): Promise<LLMResponse> {
    const startTime = Date.now();

    try {
      // Smart routing if no provider specified
      let provider = request.provider;
      let model = request.model;

      if (!provider || provider === 'auto') {
        const decision = await this.smartRouting(request);
        provider = decision.selectedProvider;
        model = decision.selectedModel;

        this.logger.info(`Smart routing selected: ${provider}/${model}`, {
          reasoning: decision.reasoning,
          confidence: decision.confidence
        });
      }

      // Process the request with the selected provider
      const response = await this.executeRequest(request, provider!, model!);

      // Update statistics
      this.updateStats(provider!, model!, response, Date.now() - startTime);

      return response;

    } catch (error) {
      this.logger.error('Request processing failed', { error, requestId: request.id });
      throw error;
    }
  }

  private async executeRequest(
    request: LLMRequest,
    provider: string,
    model: string
  ): Promise<LLMResponse> {
    const providerInstance = this.providers.get(provider);
    if (!providerInstance) {
      throw new Error(`Provider ${provider} not available`);
    }

    const startTime = Date.now();

    try {
      let response: any;

      switch (provider) {
        case 'openai':
          response = await this.processOpenAIRequest(providerInstance, request, model);
          break;
        case 'anthropic':
          response = await this.processAnthropicRequest(providerInstance, request, model);
          break;
        case 'groq':
          response = await this.processGroqRequest(providerInstance, request, model);
          break;
        case 'ollama':
          response = await this.processOllamaRequest(providerInstance, request, model);
          break;
        default:
          if (provider.startsWith('custom_')) {
            response = await this.processCustomRequest(providerInstance, request, model);
          } else {
            throw new Error(`Unsupported provider: ${provider}`);
          }
      }

      const latency = Date.now() - startTime;
      const config = this.providerConfigs.get(provider);
      const cost = this.calculateCost(response.usage, config?.pricing);

      return {
        id: `resp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        requestId: request.id,
        provider,
        model,
        content: response.content,
        usage: {
          promptTokens: response.usage?.prompt_tokens || 0,
          completionTokens: response.usage?.completion_tokens || 0,
          totalTokens: response.usage?.total_tokens || 0,
          cost
        },
        performance: {
          latency,
          throughput: response.usage?.total_tokens / (latency / 1000) || 0,
          reliability: 1.0
        },
        timestamp: new Date()
      };

    } catch (error) {
      this.logger.error(`${provider} request failed`, { error, model });
      throw error;
    }
  }

  private async processOpenAIRequest(client: OpenAI, request: LLMRequest, model: string) {
    const messages = this.buildMessages(request);

    const completion = await client.chat.completions.create({
      model,
      messages,
      max_tokens: request.options.maxTokens || 1000,
      temperature: request.options.temperature || 0.7,
      stream: request.options.stream || false
    });

    // Handle streaming vs non-streaming responses
    if ('choices' in completion && completion.choices) {
      return {
        content: completion.choices[0]?.message?.content || '',
        usage: completion.usage
      };
    } else {
      // Handle streaming response - not implemented for now
      return {
        content: '',
        usage: undefined
      };
    }
  }

  private async processAnthropicRequest(client: Anthropic, request: LLMRequest, model: string) {
    const messages = this.buildAnthropicMessages(request);

    const completion = await client.messages.create({
      model,
      messages,
      max_tokens: request.options.maxTokens || 1000,
      temperature: request.options.temperature || 0.7,
      system: request.options.systemPrompt
    });

    return {
      content: completion.content[0]?.type === 'text' ? completion.content[0].text : '',
      usage: {
        prompt_tokens: completion.usage.input_tokens,
        completion_tokens: completion.usage.output_tokens,
        total_tokens: completion.usage.input_tokens + completion.usage.output_tokens
      }
    };
  }

  private async processGroqRequest(client: Groq, request: LLMRequest, model: string) {
    const messages = this.buildMessages(request);

    const completion = await client.chat.completions.create({
      model,
      messages,
      max_tokens: request.options.maxTokens || 1000,
      temperature: request.options.temperature || 0.7,
      stream: request.options.stream || false
    });

    // Handle streaming vs non-streaming responses
    if ('choices' in completion && completion.choices) {
      return {
        content: completion.choices[0]?.message?.content || '',
        usage: completion.usage
      };
    } else {
      // Handle streaming response - not implemented for now
      return {
        content: '',
        usage: undefined
      };
    }
  }

  private async processOllamaRequest(client: Ollama, request: LLMRequest, model: string) {
    const response = await client.chat({
      model,
      messages: this.buildMessages(request),
      options: {
        temperature: request.options.temperature || 0.7,
        num_predict: request.options.maxTokens || 1000
      }
    });

    return {
      content: response.message.content,
      usage: {
        prompt_tokens: 0, // Ollama doesn't provide token counts
        completion_tokens: 0,
        total_tokens: 0
      }
    };
  }

  private async processCustomRequest(endpoint: any, request: LLMRequest, model: string) {
    const messages = this.buildMessages(request);

    const response = await axios.post(`${endpoint.baseURL}/chat/completions`, {
      model,
      messages,
      max_tokens: request.options.maxTokens || 1000,
      temperature: request.options.temperature || 0.7
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.CUSTOM_API_KEY || ''}`
      }
    });

    return {
      content: response.data.choices[0]?.message?.content || '',
      usage: response.data.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    };
  }

  private buildMessages(request: LLMRequest): any[] {
    const messages: any[] = [];

    if (request.options.systemPrompt) {
      messages.push({ role: 'system', content: request.options.systemPrompt });
    }

    if (request.context?.messages) {
      messages.push(...request.context.messages.map(msg => ({
        role: msg.role,
        content: msg.content
      })));
    }

    messages.push({ role: 'user', content: request.prompt });

    return messages;
  }

  private buildAnthropicMessages(request: LLMRequest): any[] {
    const messages: any[] = [];

    if (request.context?.messages) {
      messages.push(...request.context.messages.filter(msg => msg.role !== 'system').map(msg => ({
        role: msg.role,
        content: msg.content
      })));
    }

    messages.push({ role: 'user', content: request.prompt });

    return messages;
  }

  private calculateCost(usage: any, pricing?: { inputTokens: number; outputTokens: number }): number {
    if (!usage || !pricing) return 0;

    const inputCost = (usage.prompt_tokens / 1000) * pricing.inputTokens;
    const outputCost = (usage.completion_tokens / 1000) * pricing.outputTokens;

    return inputCost + outputCost;
  }

  private async smartRouting(request: LLMRequest): Promise<SmartRoutingDecision> {
    const availableProviders = Array.from(this.providers.keys());
    const scores: Array<{ provider: string; model: string; score: number; reasoning: string }> = [];

    for (const provider of availableProviders) {
      const config = this.providerConfigs.get(provider);
      if (!config) continue;

      for (const model of config.models) {
        const score = this.calculateProviderScore(request, provider, model, config);
        scores.push({
          provider,
          model,
          score: score.total,
          reasoning: score.reasoning
        });
      }
    }

    scores.sort((a, b) => b.score - a.score);
    const best = scores[0];

    return {
      selectedProvider: best.provider,
      selectedModel: best.model,
      reasoning: best.reasoning,
      confidence: best.score,
      alternatives: scores.slice(1, 4),
      factors: {
        cost: 0.3,
        performance: 0.4,
        capability: 0.2,
        availability: 0.1
      }
    };
  }

  private calculateProviderScore(
    request: LLMRequest,
    provider: string,
    model: string,
    config: LLMProvider
  ): { total: number; reasoning: string } {
    let score = 0;
    const factors: string[] = [];

    // Cost factor (higher score for lower cost)
    const costScore = 1 - (config.pricing.inputTokens + config.pricing.outputTokens) / 0.2;
    score += costScore * 0.3;
    factors.push(`cost: ${(costScore * 100).toFixed(0)}%`);

    // Performance factor (based on historical data)
    const stats = this.stats.get(`${provider}:${model}`);
    const performanceScore = stats ? Math.min(1000 / stats.stats.averageLatency, 1) : 0.5;
    score += performanceScore * 0.4;
    factors.push(`performance: ${(performanceScore * 100).toFixed(0)}%`);

    // Capability factor
    let capabilityScore = 0.5;
    if (request.files?.length && config.capabilities.documentAnalysis) capabilityScore += 0.3;
    if (request.prompt.includes('code') && config.capabilities.codeGeneration) capabilityScore += 0.2;
    score += capabilityScore * 0.2;
    factors.push(`capability: ${(capabilityScore * 100).toFixed(0)}%`);

    // Availability factor
    const availabilityScore = this.providers.has(provider) ? 1 : 0;
    score += availabilityScore * 0.1;
    factors.push(`availability: ${(availabilityScore * 100).toFixed(0)}%`);

    return {
      total: score,
      reasoning: `${provider}/${model} - ${factors.join(', ')}`
    };
  }

  private updateStats(provider: string, model: string, response: LLMResponse, latency: number) {
    const key = `${provider}:${model}`;
    const existing = this.stats.get(key);

    if (existing) {
      existing.stats.totalRequests++;
      existing.stats.totalTokens += response.usage.totalTokens;
      existing.stats.totalCost += response.usage.cost;
      existing.stats.averageLatency = (existing.stats.averageLatency + latency) / 2;
      existing.stats.lastUsed = new Date();
    } else {
      this.stats.set(key, {
        provider,
        model,
        stats: {
          totalRequests: 1,
          totalTokens: response.usage.totalTokens,
          totalCost: response.usage.cost,
          averageLatency: latency,
          successRate: 1,
          lastUsed: new Date()
        },
        period: 'day'
      });
    }
  }

  getAvailableProviders(): LLMProvider[] {
    return Array.from(this.providerConfigs.values());
  }

  getProviderStats(): ProviderStats[] {
    return Array.from(this.stats.values());
  }

  isProviderAvailable(provider: string): boolean {
    return this.providers.has(provider);
  }
}