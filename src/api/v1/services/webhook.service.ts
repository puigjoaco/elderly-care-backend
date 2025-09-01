import axios, { AxiosError } from 'axios';
import crypto from 'crypto';
import { supabase } from '../../../database/supabase';
import { redis } from '../../../cache/redis';
import { logger } from '../../../utils/logger';
import Queue from 'bull';

interface WebhookSubscription {
  id: string;
  organizationId: string;
  url: string;
  events: string[];
  secret: string;
  active: boolean;
  retryConfig: {
    maxAttempts: number;
    backoffMultiplier: number;
    maxBackoffSeconds: number;
  };
}

interface WebhookEvent {
  id: string;
  event: string;
  data: any;
  timestamp: string;
}

interface WebhookDelivery {
  id: string;
  subscriptionId: string;
  eventId: string;
  status: 'pending' | 'success' | 'failed';
  attempts: number;
  lastAttempt?: Date;
  response?: {
    status: number;
    body: any;
  };
  error?: string;
}

export class WebhookService {
  private webhookQueue: Queue.Queue;
  private readonly MAX_RETRIES = 5;
  private readonly RETRY_DELAYS = [1000, 5000, 30000, 60000, 300000]; // ms
  
  constructor() {
    // Initialize webhook processing queue
    this.webhookQueue = new Queue('webhooks', {
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD,
      },
    });
    
    // Process webhook jobs
    this.webhookQueue.process(async (job) => {
      return await this.processWebhookJob(job.data);
    });
    
    // Handle job failures
    this.webhookQueue.on('failed', (job, err) => {
      logger.error('Webhook job failed', {
        jobId: job.id,
        error: err.message,
        data: job.data,
      });
    });
  }
  
  async sendWebhook(event: string, data: any): Promise<void> {
    try {
      // Get all active subscriptions for this event
      const { data: subscriptions, error } = await supabase
        .from('webhook_subscriptions')
        .select('*')
        .contains('events', [event])
        .eq('active', true);
      
      if (error) {
        logger.error('Failed to fetch webhook subscriptions', { error });
        return;
      }
      
      if (!subscriptions || subscriptions.length === 0) {
        logger.debug('No webhook subscriptions for event', { event });
        return;
      }
      
      // Create webhook event record
      const { data: webhookEvent } = await supabase
        .from('webhook_events')
        .insert({
          event,
          data,
          timestamp: new Date().toISOString(),
        })
        .select()
        .single();
      
      // Queue webhooks for each subscription
      for (const subscription of subscriptions) {
        await this.queueWebhook(subscription, webhookEvent);
      }
      
      logger.info('Webhooks queued', {
        event,
        subscriptionCount: subscriptions.length,
      });
    } catch (error) {
      logger.error('Failed to send webhooks', { event, error });
    }
  }
  
  private async queueWebhook(
    subscription: WebhookSubscription,
    event: WebhookEvent
  ): Promise<void> {
    // Create delivery record
    const { data: delivery } = await supabase
      .from('webhook_deliveries')
      .insert({
        subscription_id: subscription.id,
        event_id: event.id,
        status: 'pending',
        attempts: 0,
      })
      .select()
      .single();
    
    // Add to processing queue
    await this.webhookQueue.add(
      {
        subscription,
        event,
        delivery,
      },
      {
        attempts: this.MAX_RETRIES,
        backoff: {
          type: 'custom',
          delay: this.RETRY_DELAYS[0],
        },
        removeOnComplete: true,
        removeOnFail: false,
      }
    );
  }
  
  private async processWebhookJob(jobData: any): Promise<void> {
    const { subscription, event, delivery } = jobData;
    
    try {
      // Prepare webhook payload
      const payload = {
        id: event.id,
        event: event.event,
        data: event.data,
        timestamp: event.timestamp,
        delivery: {
          id: delivery.id,
          attempt: delivery.attempts + 1,
        },
      };
      
      // Generate signature
      const signature = this.generateSignature(payload, subscription.secret);
      
      // Send webhook
      const response = await axios.post(subscription.url, payload, {
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Id': event.id,
          'X-Webhook-Event': event.event,
          'X-Webhook-Signature': signature,
          'X-Webhook-Timestamp': event.timestamp,
          'User-Agent': 'DementiaCare-Webhook/1.0',
        },
        timeout: 30000, // 30 seconds
        validateStatus: () => true, // Don't throw on HTTP errors
      });
      
      // Update delivery record
      await supabase
        .from('webhook_deliveries')
        .update({
          status: response.status >= 200 && response.status < 300 ? 'success' : 'failed',
          attempts: delivery.attempts + 1,
          last_attempt: new Date().toISOString(),
          response: {
            status: response.status,
            body: response.data,
          },
        })
        .eq('id', delivery.id);
      
      if (response.status >= 200 && response.status < 300) {
        logger.info('Webhook delivered successfully', {
          deliveryId: delivery.id,
          subscriptionId: subscription.id,
          event: event.event,
        });
      } else {
        throw new Error(`Webhook returned status ${response.status}`);
      }
    } catch (error) {
      const errorMessage = error instanceof AxiosError
        ? error.message
        : String(error);
      
      // Update delivery record
      await supabase
        .from('webhook_deliveries')
        .update({
          status: 'failed',
          attempts: delivery.attempts + 1,
          last_attempt: new Date().toISOString(),
          error: errorMessage,
        })
        .eq('id', delivery.id);
      
      // Calculate next retry delay
      const attemptIndex = Math.min(delivery.attempts, this.RETRY_DELAYS.length - 1);
      const retryDelay = this.RETRY_DELAYS[attemptIndex];
      
      logger.warn('Webhook delivery failed', {
        deliveryId: delivery.id,
        attempt: delivery.attempts + 1,
        error: errorMessage,
        nextRetryIn: retryDelay,
      });
      
      // Throw error to trigger retry
      throw new Error(errorMessage);
    }
  }
  
  private generateSignature(payload: any, secret: string): string {
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(JSON.stringify(payload));
    return `sha256=${hmac.digest('hex')}`;
  }
  
  async createSubscription(data: {
    organizationId: string;
    url: string;
    events: string[];
    secret: string;
    active: boolean;
  }): Promise<WebhookSubscription> {
    // Validate URL
    try {
      new URL(data.url);
    } catch {
      throw new Error('Invalid webhook URL');
    }
    
    // Generate secure secret if not provided
    const secret = data.secret || crypto.randomBytes(32).toString('hex');
    
    const { data: subscription, error } = await supabase
      .from('webhook_subscriptions')
      .insert({
        organization_id: data.organizationId,
        url: data.url,
        events: data.events,
        secret,
        active: data.active,
        retry_config: {
          maxAttempts: this.MAX_RETRIES,
          backoffMultiplier: 2,
          maxBackoffSeconds: 300,
        },
      })
      .select()
      .single();
    
    if (error) {
      throw error;
    }
    
    logger.info('Webhook subscription created', {
      subscriptionId: subscription.id,
      organizationId: data.organizationId,
      events: data.events,
    });
    
    return subscription;
  }
  
  async getSubscriptions(organizationId: string): Promise<WebhookSubscription[]> {
    const { data, error } = await supabase
      .from('webhook_subscriptions')
      .select('*')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false });
    
    if (error) {
      throw error;
    }
    
    return data || [];
  }
  
  async deleteSubscription(
    subscriptionId: string,
    organizationId: string
  ): Promise<void> {
    const { error } = await supabase
      .from('webhook_subscriptions')
      .delete()
      .eq('id', subscriptionId)
      .eq('organization_id', organizationId);
    
    if (error) {
      throw error;
    }
    
    logger.info('Webhook subscription deleted', {
      subscriptionId,
      organizationId,
    });
  }
  
  async testWebhook(
    subscriptionId: string,
    organizationId: string
  ): Promise<any> {
    // Get subscription
    const { data: subscription, error } = await supabase
      .from('webhook_subscriptions')
      .select('*')
      .eq('id', subscriptionId)
      .eq('organization_id', organizationId)
      .single();
    
    if (error || !subscription) {
      throw new Error('Subscription not found');
    }
    
    // Send test webhook
    const testEvent = {
      id: crypto.randomUUID(),
      event: 'test.webhook',
      data: {
        message: 'This is a test webhook',
        timestamp: new Date().toISOString(),
      },
      timestamp: new Date().toISOString(),
    };
    
    const payload = {
      ...testEvent,
      test: true,
    };
    
    const signature = this.generateSignature(payload, subscription.secret);
    
    try {
      const response = await axios.post(subscription.url, payload, {
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Id': testEvent.id,
          'X-Webhook-Event': 'test.webhook',
          'X-Webhook-Signature': signature,
          'X-Webhook-Timestamp': testEvent.timestamp,
          'User-Agent': 'DementiaCare-Webhook/1.0',
        },
        timeout: 10000,
        validateStatus: () => true,
      });
      
      return {
        success: response.status >= 200 && response.status < 300,
        status: response.status,
        headers: response.headers,
        body: response.data,
      };
    } catch (error) {
      if (error instanceof AxiosError) {
        return {
          success: false,
          error: error.message,
          code: error.code,
        };
      }
      throw error;
    }
  }
  
  async getDeliveryHistory(
    subscriptionId: string,
    limit = 100
  ): Promise<WebhookDelivery[]> {
    const { data, error } = await supabase
      .from('webhook_deliveries')
      .select(`
        *,
        webhook_events (*)
      `)
      .eq('subscription_id', subscriptionId)
      .order('created_at', { ascending: false })
      .limit(limit);
    
    if (error) {
      throw error;
    }
    
    return data || [];
  }
  
  async retryDelivery(deliveryId: string): Promise<void> {
    const { data: delivery, error } = await supabase
      .from('webhook_deliveries')
      .select(`
        *,
        webhook_subscriptions (*),
        webhook_events (*)
      `)
      .eq('id', deliveryId)
      .single();
    
    if (error || !delivery) {
      throw new Error('Delivery not found');
    }
    
    // Queue for retry
    await this.queueWebhook(
      delivery.webhook_subscriptions,
      delivery.webhook_events
    );
    
    logger.info('Webhook delivery queued for retry', { deliveryId });
  }
  
  // Cleanup old webhook records
  async cleanup(daysToKeep = 30): Promise<void> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
    
    // Delete old events
    const { error: eventsError } = await supabase
      .from('webhook_events')
      .delete()
      .lt('created_at', cutoffDate.toISOString());
    
    if (eventsError) {
      logger.error('Failed to cleanup webhook events', { error: eventsError });
    }
    
    // Delete old deliveries
    const { error: deliveriesError } = await supabase
      .from('webhook_deliveries')
      .delete()
      .lt('created_at', cutoffDate.toISOString());
    
    if (deliveriesError) {
      logger.error('Failed to cleanup webhook deliveries', { error: deliveriesError });
    }
    
    logger.info('Webhook cleanup completed', {
      cutoffDate: cutoffDate.toISOString(),
    });
  }
}