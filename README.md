# Universal LLM Slack Hub

🚀 **Connect any AI model to Slack with smart routing, cost optimization, and enterprise features**

## 🌟 Key Features

- **Multi-LLM Support**: OpenAI, Anthropic, Groq, Ollama, custom endpoints
- **Smart Routing**: Automatically selects the best LLM for each task
- **Cost Optimization**: Real-time cost tracking and budget management
- **Enterprise Ready**: Subscription tiers, usage analytics, team management
- **Production Scalable**: DigitalOcean deployment with auto-scaling
- **Slack Native**: Rich commands, file analysis, conversation memory

## 🏗️ Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Slack Bot     │    │  Smart Router    │    │   LLM Providers │
│                 │───▶│                  │───▶│                 │
│ • Commands      │    │ • Cost Analysis  │    │ • OpenAI        │
│ • Events        │    │ • Performance    │    │ • Anthropic     │
│ • Files         │    │ • Capability     │    │ • Groq          │
└─────────────────┘    └──────────────────┘    │ • Ollama        │
                                               │ • Custom APIs   │
┌─────────────────┐    ┌──────────────────┐    └─────────────────┘
│   Analytics     │    │   User Manager   │
│                 │    │                  │
│ • Usage Metrics │    │ • Subscriptions  │
│ • Cost Tracking │    │ • Rate Limits    │
│ • Performance   │    │ • Team Settings  │
└─────────────────┘    └──────────────────┘
```

## 🎯 Supported LLM Providers

| Provider    | Models Available                                    | Capabilities                           |
|-------------|----------------------------------------------------|-----------------------------------------|
| **OpenAI**  | GPT-4, GPT-4 Turbo, GPT-3.5 Turbo                | Text, Code, Images, Function Calling   |
| **Anthropic** | Claude-3.5 Sonnet, Claude-3 Haiku, Claude-3 Opus | Text, Code, Images, Long Context       |
| **Groq**    | Llama-3.1, Mixtral, Gemma                         | Fast Text Generation, Code              |
| **Ollama**  | Local Models (Llama2, CodeLlama, Mistral)         | Privacy, No API Costs                  |
| **Custom**  | Any OpenAI-compatible API                          | Flexible Integration                    |

## 🚀 Quick Start

### 1. Installation

```bash
git clone <repository>
cd universal-llm-hub_slack
npm install
```

### 2. Environment Setup

```bash
cp .env.example .env
# Edit .env with your API keys and configuration
```

### 3. Local Development

```bash
# Start Redis (required)
docker run -d -p 6379:6379 redis:alpine

# Start the application
npm run dev
```

### 4. Slack App Setup

1. Create a new Slack app at [api.slack.com](https://api.slack.com/apps)
2. Configure OAuth & Permissions with required scopes
3. Set up Event Subscriptions pointing to your webhook URL
4. Add slash commands: `/ai`, `/ai-claude`, `/ai-gpt4`, `/ai-groq`
5. Install the app to your workspace

## 📋 Available Commands

### Basic Commands
- `/ai <prompt>` - Ask any question with smart provider selection
- `/ai-gpt4 <prompt>` - Use OpenAI GPT-4 specifically
- `/ai-claude <prompt>` - Use Anthropic Claude specifically
- `/ai-groq <prompt>` - Use Groq models specifically

### Advanced Commands
- `/ai-compare <prompt>` - Compare responses across multiple providers
- `/ai-analyze <content>` - Deep analysis with structured insights
- `/ai-generate <request>` - Creative content generation
- `/ai-summarize <content>` - Concise summaries
- `/ai-code <task>` - Programming assistance

### Utility Commands
- `/ai-providers` - List available providers and their status
- `/ai-usage` - Check your usage and billing
- `/ai-help` - Get help and tips

## 🏢 Enterprise Features

### Subscription Tiers

| Feature | Free | Pro | Enterprise |
|---------|------|-----|------------|
| Monthly Requests | 100 | 5,000 | Unlimited |
| Max Tokens/Request | 4,000 | 8,000 | 32,000 |
| Providers | Basic | All | All + Custom |
| Analytics | Basic | Advanced | Full |
| Support | Community | Email | Priority |

### Team Management
- Role-based access controls
- Usage quotas per user
- Custom prompt libraries
- Audit logging

### Cost Management
- Real-time cost tracking
- Budget alerts and limits
- Automatic fallback to cheaper models
- Detailed billing reports

## 🐳 Production Deployment

### DigitalOcean Deployment (Recommended)

```bash
# Install doctl (DigitalOcean CLI)
# Configure your DO account and API token

# Deploy to App Platform (managed, auto-scaling)
./scripts/deploy-digitalocean.sh

# Choose option 1 for App Platform deployment
```

### Manual Docker Deployment

```bash
# Build and run with Docker Compose
docker-compose up -d

# Or build manually
docker build -t universal-llm-hub .
docker run -d -p 3000:3000 --env-file .env universal-llm-hub
```

### Environment Variables

Required:
- `SLACK_BOT_TOKEN` - Your Slack bot token
- `SLACK_SIGNING_SECRET` - Your Slack signing secret

LLM Providers (at least one required):
- `OPENAI_API_KEY` - OpenAI API key
- `ANTHROPIC_API_KEY` - Anthropic API key
- `GROQ_API_KEY` - Groq API key
- `OLLAMA_BASE_URL` - Ollama server URL (for local models)

Infrastructure:
- `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` - Redis connection
- `DATABASE_URL` - PostgreSQL connection (optional, uses in-memory by default)

## 📊 Monitoring & Analytics

### Health Endpoints
- `GET /health` - Basic health check
- `GET /health/detailed` - Detailed system status
- `GET /metrics` - Prometheus-compatible metrics

### Key Metrics
- Request latency by provider
- Cost per request and total spend
- Success rates and error tracking
- User activity and popular commands

### Logging
All events are logged with structured JSON format:
```json
{
  "timestamp": "2025-01-15T10:30:00Z",
  "level": "info",
  "service": "LLMProviderManager",
  "message": "Request processed successfully",
  "provider": "openai",
  "model": "gpt-4",
  "tokens": 150,
  "cost": 0.003,
  "latency": 1200
}
```

## 🔒 Security Features

- Input validation and sanitization
- Rate limiting per user and team
- Secure credential management
- Request logging and audit trails
- CORS protection
- Helmet.js security headers

## 🛠️ Development

### Project Structure

```
src/
├── services/           # Core business logic
│   ├── LLMProviderManager.ts
│   ├── CommandProcessor.ts
│   ├── ConversationManager.ts
│   └── UserManager.ts
├── types/             # TypeScript definitions
├── commands/          # Slack command handlers
├── middleware/        # Express middleware
└── utils/             # Helper functions
```

### Adding New Providers

1. Extend the `LLMProviderManager` class
2. Add provider configuration to `initializeProviderConfigs()`
3. Implement the provider-specific request handling
4. Update environment variables and documentation

### Testing

```bash
# Run tests
npm test

# Run with coverage
npm run test:coverage

# Integration tests
npm run test:integration
```

## 📈 Scaling & Performance

### Recommended Infrastructure

| Users | Instance Type | Resources | Monthly Cost |
|-------|---------------|-----------|--------------|
| 1-50 | DO App Platform Basic | 512MB RAM, 1 vCPU | $5-15 |
| 50-200 | DO App Platform Pro | 1GB RAM, 1 vCPU | $12-25 |
| 200-1000 | DO Droplet + Load Balancer | 4GB RAM, 2 vCPU | $25-50 |
| 1000+ | Multi-region, Auto-scaling | Custom | $100+ |

### Performance Optimization

- Redis caching for conversation context
- Connection pooling for LLM providers
- Request deduplication
- Response streaming for long outputs
- CDN for static assets

## 🐛 Troubleshooting

### Common Issues

**Bot not responding**
- Check Slack app event subscriptions
- Verify webhook URL is accessible
- Check application logs for errors

**High latency**
- Monitor LLM provider response times
- Check Redis connection
- Consider enabling response caching

**Cost overruns**
- Review usage analytics
- Implement stricter rate limits
- Configure budget alerts

### Debug Mode

```bash
LOG_LEVEL=debug npm run dev
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details

## 🆘 Support

- 📧 Email: support@yourdomain.com
- 💬 Slack: #llm-hub-support
- 📚 Docs: https://docs.yourdomain.com
- 🐛 Issues: GitHub Issues

---

**Built with ❤️ for teams who want AI superpowers in Slack**