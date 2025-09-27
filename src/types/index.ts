export interface LLMProvider {
  name: string;
  type: 'openai' | 'anthropic' | 'groq' | 'ollama' | 'custom';
  models: string[];
  pricing: {
    inputTokens: number;  // per 1K tokens
    outputTokens: number; // per 1K tokens
  };
  capabilities: {
    textGeneration: boolean;
    codeGeneration: boolean;
    imageAnalysis: boolean;
    documentAnalysis: boolean;
    functionCalling: boolean;
    streaming: boolean;
  };
  limits: {
    maxTokens: number;
    maxRequestsPerMinute: number;
    maxRequestsPerDay: number;
  };
}

export interface LLMRequest {
  id: string;
  userId: string;
  teamId: string;
  provider?: string | undefined;
  model?: string | undefined;
  prompt: string;
  context?: ConversationContext | undefined;
  files?: FileAttachment[] | undefined;
  options: {
    maxTokens?: number | undefined;
    temperature?: number | undefined;
    stream?: boolean | undefined;
    systemPrompt?: string | undefined;
  };
  priority: 'low' | 'normal' | 'high' | 'urgent';
  metadata: {
    command?: string | undefined;
    channel?: string | undefined;
    timestamp: Date;
    estimatedCost?: number | undefined;
  };
}

export interface LLMResponse {
  id: string;
  requestId: string;
  provider: string;
  model: string;
  content: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cost: number;
  };
  performance: {
    latency: number;
    throughput: number;
    reliability: number;
  };
  timestamp: Date;
  error?: string;
}

export interface ConversationContext {
  conversationId: string;
  messages: ConversationMessage[];
  summary?: string;
  totalTokens: number;
  createdAt: Date;
  lastUpdatedAt: Date;
}

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  provider?: string;
  model?: string;
  tokens?: number;
}

export interface FileAttachment {
  id: string;
  name: string;
  type: 'pdf' | 'image' | 'text' | 'code' | 'document';
  size: number;
  url: string;
  extractedText?: string;
  analysis?: any;
}

export interface UserSubscription {
  userId: string;
  teamId: string;
  tier: 'free' | 'pro' | 'enterprise';
  stripeSubscriptionId?: string;
  limits: {
    monthlyRequests: number;
    maxTokensPerRequest: number;
    providers: string[];
    features: string[];
  };
  usage: {
    requestsThisMonth: number;
    tokensThisMonth: number;
    costThisMonth: number;
  };
  status: 'active' | 'canceled' | 'past_due' | 'trialing';
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
}

export interface ProviderStats {
  provider: string;
  model: string;
  stats: {
    totalRequests: number;
    totalTokens: number;
    totalCost: number;
    averageLatency: number;
    successRate: number;
    lastUsed: Date;
  };
  period: 'hour' | 'day' | 'week' | 'month';
}

export interface SmartRoutingDecision {
  selectedProvider: string;
  selectedModel: string;
  reasoning: string;
  confidence: number;
  alternatives: Array<{
    provider: string;
    model: string;
    score: number;
    reasoning: string;
  }>;
  factors: {
    cost: number;
    performance: number;
    capability: number;
    availability: number;
  };
}

export interface CustomPrompt {
  id: string;
  name: string;
  description: string;
  template: string;
  variables: string[];
  teamId: string;
  isPublic: boolean;
  category: string;
  tags: string[];
  usage: number;
  createdBy: string;
  createdAt: Date;
}

export interface TeamSettings {
  teamId: string;
  name: string;
  settings: {
    defaultProvider: string;
    defaultModel: string;
    maxTokensPerRequest: number;
    allowedProviders: string[];
    customPrompts: string[];
    moderationEnabled: boolean;
    loggingLevel: 'none' | 'basic' | 'full';
  };
  billing: {
    stripeCustomerId: string;
    subscription: UserSubscription;
    billingEmail: string;
  };
  members: Array<{
    userId: string;
    role: 'admin' | 'member' | 'viewer';
    permissions: string[];
  }>;
}

export interface HealthCheck {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: Date;
  services: {
    slack: boolean;
    redis: boolean;
    database: boolean;
    providers: Record<string, boolean>;
  };
  metrics: {
    uptime: number;
    memoryUsage: number;
    cpuUsage: number;
    activeConnections: number;
  };
}

export type CommandType =
  | 'ask'
  | 'compare'
  | 'analyze'
  | 'generate'
  | 'summarize'
  | 'translate'
  | 'code'
  | 'custom';

export interface SlackCommand {
  type: CommandType;
  provider?: string | undefined;
  model?: string | undefined;
  prompt: string;
  files?: string[] | undefined;
  options?: Record<string, any> | undefined;
}

export interface AnalyticsEvent {
  id: string;
  type: string;
  userId: string;
  teamId: string;
  timestamp: Date;
  data: Record<string, any>;
  cost?: number;
  success: boolean;
}