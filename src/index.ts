import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import { createServer } from 'http';
import { Server } from 'ws';
import * as Sentry from '@sentry/node';
import dotenv from 'dotenv';
import { apiV1Router } from './api/v1/routes';
import { errorHandler } from './api/v1/middleware/errorHandler';
import { rateLimiter } from './api/v1/middleware/rateLimiter';
import { requestLogger } from './api/v1/middleware/requestLogger';
import { healthCheck } from './api/v1/middleware/healthCheck';
import { setupWebhooks } from './api/v1/webhooks';
import { initializeDatabase } from './database';
import { initializeCache } from './cache';
import { initializeQueue } from './queue';
import { logger } from './utils/logger';
import { config } from './config';

// Load environment variables
dotenv.config();

// Initialize Sentry for error tracking
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV || 'development',
  integrations: [
    new Sentry.Integrations.Http({ tracing: true }),
    new Sentry.Integrations.Express({ app: express() }),
  ],
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  beforeSend(event) {
    // Remove sensitive data
    if (event.request) {
      delete event.request.cookies;
      delete event.request.headers?.authorization;
      delete event.request.headers?.['x-api-key'];
    }
    return event;
  },
});

// Create Express app
const app = express();
const server = createServer(app);

// WebSocket server for real-time updates
const wss = new Server({
  server,
  path: '/ws',
  verifyClient: (info, cb) => {
    // Verify WebSocket connections
    const token = info.req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      cb(false, 401, 'Unauthorized');
      return;
    }
    // Verify token (implement verification logic)
    cb(true);
  },
});

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
}));

// CORS configuration
app.use(cors({
  origin: (origin, callback) => {
    const allowedOrigins = config.cors.allowedOrigins;
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Request-ID'],
  exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
}));

// Compression
app.use(compression());

// Request parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logging
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined', {
    stream: {
      write: (message) => logger.info(message.trim()),
    },
  }));
}

// Request tracking
app.use(requestLogger);

// Sentry request handler
app.use(Sentry.Handlers.requestHandler());

// Rate limiting
app.use('/api/', rateLimiter);

// Health check endpoint
app.get('/health', healthCheck);

// API v1 routes
app.use('/api/v1', apiV1Router);

// Webhook endpoints
setupWebhooks(app);

// Swagger documentation
if (process.env.NODE_ENV !== 'production') {
  const swaggerUi = require('swagger-ui-express');
  const swaggerSpec = require('./api/v1/docs/swagger').swaggerSpec;
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
}

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} not found`,
    timestamp: new Date().toISOString(),
  });
});

// Sentry error handler (must be before other error handlers)
app.use(Sentry.Handlers.errorHandler());

// Error handling middleware
app.use(errorHandler);

// WebSocket connection handling
wss.on('connection', (ws, req) => {
  const clientId = req.headers['x-client-id'] || 'unknown';
  logger.info(`WebSocket client connected: ${clientId}`);

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      // Handle WebSocket messages
      handleWebSocketMessage(ws, message);
    } catch (error) {
      ws.send(JSON.stringify({ error: 'Invalid message format' }));
    }
  });

  ws.on('close', () => {
    logger.info(`WebSocket client disconnected: ${clientId}`);
  });

  ws.on('error', (error) => {
    logger.error(`WebSocket error for client ${clientId}:`, error);
  });

  // Send initial connection confirmation
  ws.send(JSON.stringify({
    type: 'connection',
    status: 'connected',
    timestamp: new Date().toISOString(),
  }));
});

function handleWebSocketMessage(ws: any, message: any) {
  switch (message.type) {
    case 'subscribe':
      // Handle subscription to events
      ws.subscriptions = ws.subscriptions || [];
      ws.subscriptions.push(message.channel);
      ws.send(JSON.stringify({
        type: 'subscribed',
        channel: message.channel,
      }));
      break;
    case 'unsubscribe':
      // Handle unsubscription
      if (ws.subscriptions) {
        ws.subscriptions = ws.subscriptions.filter(
          (s: string) => s !== message.channel
        );
      }
      ws.send(JSON.stringify({
        type: 'unsubscribed',
        channel: message.channel,
      }));
      break;
    case 'ping':
      ws.send(JSON.stringify({ type: 'pong' }));
      break;
    default:
      ws.send(JSON.stringify({ error: 'Unknown message type' }));
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully...');
  
  // Close WebSocket connections
  wss.clients.forEach((client) => {
    client.close(1000, 'Server shutting down');
  });
  
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
  
  // Force shutdown after 30 seconds
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
});

// Start server
async function startServer() {
  try {
    // Initialize database connection
    await initializeDatabase();
    logger.info('Database initialized');
    
    // Initialize cache
    await initializeCache();
    logger.info('Cache initialized');
    
    // Initialize job queue
    await initializeQueue();
    logger.info('Queue initialized');
    
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV}`);
      if (process.env.NODE_ENV !== 'production') {
        logger.info(`API Documentation: http://localhost:${PORT}/api-docs`);
      }
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
startServer();

export { app, server, wss };