import { Express, Request, Response } from 'express';
import crypto from 'crypto';
import { WebhookService } from '../services/webhook.service';
import { logger } from '../../../utils/logger';
import { validateWebhookSignature } from './security';

const webhookService = new WebhookService();

export function setupWebhooks(app: Express): void {
  // Webhook endpoint for receiving external events
  app.post('/webhooks/receive', async (req: Request, res: Response) => {
    try {
      // Validate webhook signature
      const signature = req.headers['x-webhook-signature'] as string;
      const isValid = validateWebhookSignature(
        req.body,
        signature,
        process.env.WEBHOOK_SECRET!
      );
      
      if (!isValid) {
        logger.warn('Invalid webhook signature', {
          ip: req.ip,
          headers: req.headers,
        });
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }
      
      // Process webhook
      const { event, data, timestamp } = req.body;
      
      logger.info('Webhook received', {
        event,
        timestamp,
      });
      
      // Handle different webhook events
      switch (event) {
        case 'external.vitals.update':
          await handleVitalsUpdate(data);
          break;
        case 'external.medication.dispensed':
          await handleMedicationDispensed(data);
          break;
        case 'external.lab.results':
          await handleLabResults(data);
          break;
        case 'external.appointment.scheduled':
          await handleAppointmentScheduled(data);
          break;
        case 'external.emergency.alert':
          await handleEmergencyAlert(data);
          break;
        default:
          logger.warn('Unknown webhook event', { event });
      }
      
      // Acknowledge receipt
      res.json({
        received: true,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Webhook processing error', { error });
      res.status(500).json({ error: 'Internal server error' });
    }
  });
  
  // Endpoint to register webhook subscriptions
  app.post('/api/v1/webhooks/subscribe', async (req: Request, res: Response) => {
    try {
      const { url, events, secret, active = true } = req.body;
      
      const subscription = await webhookService.createSubscription({
        organizationId: req.apiKey.organizationId,
        url,
        events,
        secret,
        active,
      });
      
      res.status(201).json({
        success: true,
        data: subscription,
        message: 'Webhook subscription created',
      });
    } catch (error) {
      logger.error('Failed to create webhook subscription', { error });
      res.status(500).json({ error: 'Failed to create subscription' });
    }
  });
  
  // List webhook subscriptions
  app.get('/api/v1/webhooks/subscriptions', async (req: Request, res: Response) => {
    try {
      const subscriptions = await webhookService.getSubscriptions(
        req.apiKey.organizationId
      );
      
      res.json({
        success: true,
        data: subscriptions,
      });
    } catch (error) {
      logger.error('Failed to fetch webhook subscriptions', { error });
      res.status(500).json({ error: 'Failed to fetch subscriptions' });
    }
  });
  
  // Delete webhook subscription
  app.delete('/api/v1/webhooks/subscriptions/:id', async (req: Request, res: Response) => {
    try {
      await webhookService.deleteSubscription(
        req.params.id,
        req.apiKey.organizationId
      );
      
      res.json({
        success: true,
        message: 'Webhook subscription deleted',
      });
    } catch (error) {
      logger.error('Failed to delete webhook subscription', { error });
      res.status(500).json({ error: 'Failed to delete subscription' });
    }
  });
  
  // Test webhook endpoint
  app.post('/api/v1/webhooks/test/:id', async (req: Request, res: Response) => {
    try {
      const result = await webhookService.testWebhook(
        req.params.id,
        req.apiKey.organizationId
      );
      
      res.json({
        success: true,
        data: result,
        message: 'Test webhook sent',
      });
    } catch (error) {
      logger.error('Failed to send test webhook', { error });
      res.status(500).json({ error: 'Failed to send test webhook' });
    }
  });
}

// Webhook event handlers
async function handleVitalsUpdate(data: any): Promise<void> {
  try {
    const { patientId, vitals, timestamp } = data;
    
    // Store vitals in database
    const { supabase } = require('../../../database/supabase');
    await supabase.from('vitals').insert({
      patient_id: patientId,
      ...vitals,
      source: 'external_webhook',
      recorded_at: timestamp,
    });
    
    // Check for critical values
    if (vitals.blood_pressure_systolic > 180 || vitals.blood_pressure_diastolic > 120) {
      await sendCriticalAlert('HIGH_BLOOD_PRESSURE', patientId, vitals);
    }
    
    if (vitals.heart_rate > 120 || vitals.heart_rate < 50) {
      await sendCriticalAlert('ABNORMAL_HEART_RATE', patientId, vitals);
    }
    
    logger.info('Vitals updated via webhook', { patientId });
  } catch (error) {
    logger.error('Failed to handle vitals update', { error, data });
    throw error;
  }
}

async function handleMedicationDispensed(data: any): Promise<void> {
  try {
    const { patientId, medicationId, quantity, dispensedAt, pharmacyId } = data;
    
    // Update medication inventory
    const { supabase } = require('../../../database/supabase');
    await supabase.from('medication_dispensing').insert({
      patient_id: patientId,
      medication_id: medicationId,
      quantity,
      dispensed_at: dispensedAt,
      pharmacy_id: pharmacyId,
      source: 'external_webhook',
    });
    
    // Update medication adherence tracking
    await supabase.from('medication_adherence').insert({
      patient_id: patientId,
      medication_id: medicationId,
      status: 'dispensed',
      timestamp: dispensedAt,
    });
    
    logger.info('Medication dispensed via webhook', { patientId, medicationId });
  } catch (error) {
    logger.error('Failed to handle medication dispensed', { error, data });
    throw error;
  }
}

async function handleLabResults(data: any): Promise<void> {
  try {
    const { patientId, labId, results, orderedBy, performedAt } = data;
    
    // Store lab results
    const { supabase } = require('../../../database/supabase');
    const { data: labRecord } = await supabase.from('lab_results').insert({
      patient_id: patientId,
      lab_id: labId,
      results,
      ordered_by: orderedBy,
      performed_at: performedAt,
      source: 'external_webhook',
    }).select().single();
    
    // Check for critical values
    for (const test of results) {
      if (test.isCritical) {
        await sendCriticalAlert('CRITICAL_LAB_RESULT', patientId, {
          test: test.name,
          value: test.value,
          reference: test.referenceRange,
        });
      }
    }
    
    // Notify care team
    await webhookService.sendWebhook('lab.results.received', {
      patientId,
      labRecordId: labRecord.id,
      criticalCount: results.filter((r: any) => r.isCritical).length,
    });
    
    logger.info('Lab results received via webhook', { patientId, labId });
  } catch (error) {
    logger.error('Failed to handle lab results', { error, data });
    throw error;
  }
}

async function handleAppointmentScheduled(data: any): Promise<void> {
  try {
    const { patientId, providerId, appointmentDate, type, location } = data;
    
    // Store appointment
    const { supabase } = require('../../../database/supabase');
    await supabase.from('appointments').insert({
      patient_id: patientId,
      provider_id: providerId,
      appointment_date: appointmentDate,
      type,
      location,
      status: 'scheduled',
      source: 'external_webhook',
    });
    
    // Create reminder
    await supabase.from('reminders').insert({
      patient_id: patientId,
      type: 'appointment',
      title: `Appointment with ${providerId}`,
      description: `${type} appointment at ${location}`,
      reminder_date: new Date(appointmentDate).getTime() - 86400000, // 1 day before
    });
    
    logger.info('Appointment scheduled via webhook', { patientId, appointmentDate });
  } catch (error) {
    logger.error('Failed to handle appointment scheduled', { error, data });
    throw error;
  }
}

async function handleEmergencyAlert(data: any): Promise<void> {
  try {
    const { patientId, type, severity, message, location, timestamp } = data;
    
    // Store emergency alert
    const { supabase } = require('../../../database/supabase');
    const { data: alert } = await supabase.from('emergency_alerts').insert({
      patient_id: patientId,
      type,
      severity,
      message,
      location,
      timestamp,
      source: 'external_webhook',
      status: 'active',
    }).select().single();
    
    // Send immediate notifications to all family members and caregivers
    await sendEmergencyNotifications(patientId, {
      alertId: alert.id,
      type,
      severity,
      message,
      location,
    });
    
    // Trigger emergency protocol
    if (severity === 'critical') {
      await triggerEmergencyProtocol(patientId, alert.id);
    }
    
    logger.error('EMERGENCY ALERT received via webhook', {
      patientId,
      type,
      severity,
      alertId: alert.id,
    });
  } catch (error) {
    logger.error('Failed to handle emergency alert', { error, data });
    throw error;
  }
}

// Helper functions
async function sendCriticalAlert(
  type: string,
  patientId: string,
  data: any
): Promise<void> {
  const alertService = require('../services/alerts.service');
  await alertService.sendCriticalAlert({
    type,
    patientId,
    data,
    priority: 'high',
  });
}

async function sendEmergencyNotifications(
  patientId: string,
  alertData: any
): Promise<void> {
  const notificationService = require('../services/notification.service');
  await notificationService.sendEmergencyNotifications(patientId, alertData);
}

async function triggerEmergencyProtocol(
  patientId: string,
  alertId: string
): Promise<void> {
  const emergencyService = require('../services/emergency.service');
  await emergencyService.triggerProtocol(patientId, alertId);
}