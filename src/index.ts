import dotenv from 'dotenv';
import { SlackApp } from './SlackApp.js';
import { Logger } from './services/Logger.js';

// Load environment variables
dotenv.config();

const logger = new Logger('Main');

async function main() {
  try {
    // Validate required environment variables
    const required = [
      'SLACK_BOT_TOKEN',
      'SLACK_SIGNING_SECRET'
    ];

    const missing = required.filter(key => !process.env[key]);
    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }

    // Log LLM provider availability
    const providers = [];
    if (process.env.OPENAI_API_KEY) providers.push('OpenAI');
    if (process.env.ANTHROPIC_API_KEY) providers.push('Anthropic');
    if (process.env.GROQ_API_KEY) providers.push('Groq');
    if (process.env.OLLAMA_BASE_URL) providers.push('Ollama');

    logger.info(`Starting Universal LLM Slack Hub with providers: ${providers.join(', ')}`);

    // Initialize and start the app
    const app = new SlackApp();
    await app.start();

    // Graceful shutdown
    process.on('SIGTERM', async () => {
      logger.info('Received SIGTERM, shutting down gracefully');
      await app.stop();
      process.exit(0);
    });

    process.on('SIGINT', async () => {
      logger.info('Received SIGINT, shutting down gracefully');
      await app.stop();
      process.exit(0);
    });

  } catch (error) {
    logger.error('Failed to start application', { error });
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});