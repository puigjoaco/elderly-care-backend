import { Request, Response, NextFunction } from 'express';
import { PatientsService } from '../services/patients.service';
import { logger } from '../../../utils/logger';
import { ApiResponse } from '../../../types/api';
import { clearCache } from '../middleware/cache';

const patientsService = new PatientsService();

export async function getPatients(
  req: Request,
  res: Response<ApiResponse>,
  next: NextFunction
): Promise<void> {
  try {
    const { page = 1, limit = 20, search, status, familyId } = req.query;
    
    const result = await patientsService.getPatients({
      page: Number(page),
      limit: Number(limit),
      search: search as string,
      status: status as string,
      familyId: familyId as string,
      userId: req.user.id,
      userRole: req.user.role,
    });
    
    res.json({
      success: true,
      data: result.data,
      pagination: result.pagination,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
}

export async function getPatient(
  req: Request,
  res: Response<ApiResponse>,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;
    const { includeRelations = false } = req.query;
    
    const patient = await patientsService.getPatient(
      id,
      req.user.id,
      req.user.role,
      includeRelations === 'true'
    );
    
    if (!patient) {
      res.status(404).json({
        success: false,
        error: 'Patient not found',
        timestamp: new Date().toISOString(),
      });
      return;
    }
    
    res.json({
      success: true,
      data: patient,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
}

export async function createPatient(
  req: Request,
  res: Response<ApiResponse>,
  next: NextFunction
): Promise<void> {
  try {
    const patientData = req.body;
    
    const patient = await patientsService.createPatient({
      ...patientData,
      createdBy: req.user.id,
    });
    
    // Clear cache
    await clearCache('patients');
    
    // Send webhook notification
    await sendWebhook('patient.created', patient);
    
    res.status(201).json({
      success: true,
      data: patient,
      message: 'Patient created successfully',
      timestamp: new Date().toISOString(),
    });
    
    logger.info('Patient created', {
      patientId: patient.id,
      createdBy: req.user.id,
    });
  } catch (error) {
    next(error);
  }
}

export async function updatePatient(
  req: Request,
  res: Response<ApiResponse>,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;
    const updates = req.body;
    
    const patient = await patientsService.updatePatient(
      id,
      updates,
      req.user.id,
      req.user.role
    );
    
    // Clear cache
    await clearCache(['patients', `patient:${id}`]);
    
    // Send webhook notification
    await sendWebhook('patient.updated', patient);
    
    res.json({
      success: true,
      data: patient,
      message: 'Patient updated successfully',
      timestamp: new Date().toISOString(),
    });
    
    logger.info('Patient updated', {
      patientId: id,
      updatedBy: req.user.id,
      changes: Object.keys(updates),
    });
  } catch (error) {
    next(error);
  }
}

export async function deletePatient(
  req: Request,
  res: Response<ApiResponse>,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;
    const { soft = true } = req.query;
    
    await patientsService.deletePatient(
      id,
      req.user.id,
      soft === 'true'
    );
    
    // Clear cache
    await clearCache(['patients', `patient:${id}`]);
    
    // Send webhook notification
    await sendWebhook('patient.deleted', { id, deletedBy: req.user.id });
    
    res.json({
      success: true,
      message: soft === 'true' ? 'Patient archived successfully' : 'Patient deleted permanently',
      timestamp: new Date().toISOString(),
    });
    
    logger.info('Patient deleted', {
      patientId: id,
      deletedBy: req.user.id,
      soft: soft === 'true',
    });
  } catch (error) {
    next(error);
  }
}

export async function getPatientSummary(
  req: Request,
  res: Response<ApiResponse>,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;
    const { startDate, endDate } = req.query;
    
    const summary = await patientsService.getPatientSummary(
      id,
      req.user.id,
      req.user.role,
      {
        startDate: startDate ? new Date(startDate as string) : undefined,
        endDate: endDate ? new Date(endDate as string) : undefined,
      }
    );
    
    res.json({
      success: true,
      data: summary,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
}

export async function getPatientTimeline(
  req: Request,
  res: Response<ApiResponse>,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;
    const { startDate, endDate, eventTypes } = req.query;
    
    const timeline = await patientsService.getPatientTimeline(
      id,
      req.user.id,
      req.user.role,
      {
        startDate: startDate ? new Date(startDate as string) : undefined,
        endDate: endDate ? new Date(endDate as string) : undefined,
        eventTypes: eventTypes ? (eventTypes as string).split(',') : undefined,
      }
    );
    
    res.json({
      success: true,
      data: timeline,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
}

export async function addEmergencyContact(
  req: Request,
  res: Response<ApiResponse>,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;
    const contactData = req.body;
    
    const contact = await patientsService.addEmergencyContact(
      id,
      contactData,
      req.user.id
    );
    
    // Clear cache
    await clearCache(`patient:${id}`);
    
    res.status(201).json({
      success: true,
      data: contact,
      message: 'Emergency contact added successfully',
      timestamp: new Date().toISOString(),
    });
    
    logger.info('Emergency contact added', {
      patientId: id,
      contactId: contact.id,
      addedBy: req.user.id,
    });
  } catch (error) {
    next(error);
  }
}

export async function getPatientPredictions(
  req: Request,
  res: Response<ApiResponse>,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;
    const { forceRefresh = false } = req.query;
    
    const predictions = await patientsService.getPatientPredictions(
      id,
      req.user.id,
      req.user.role,
      forceRefresh === 'true'
    );
    
    res.json({
      success: true,
      data: predictions,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
}

export async function addClinicalNote(
  req: Request,
  res: Response<ApiResponse>,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;
    const { content, type, attachments } = req.body;
    
    const note = await patientsService.addClinicalNote(
      id,
      {
        content,
        type,
        attachments,
        authorId: req.user.id,
        authorRole: req.user.role,
      }
    );
    
    // Clear cache
    await clearCache(`patient:${id}`);
    
    // Send notification to family members
    if (type === 'critical' || type === 'incident') {
      await sendWebhook('clinical.note.critical', {
        patientId: id,
        noteId: note.id,
        type,
        authorId: req.user.id,
      });
    }
    
    res.status(201).json({
      success: true,
      data: note,
      message: 'Clinical note added successfully',
      timestamp: new Date().toISOString(),
    });
    
    logger.info('Clinical note added', {
      patientId: id,
      noteId: note.id,
      type,
      authorId: req.user.id,
    });
  } catch (error) {
    next(error);
  }
}

// External API methods
export async function getPatientForExternal(
  req: Request,
  res: Response<ApiResponse>,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;
    const { format = 'standard' } = req.query;
    
    const patient = await patientsService.getPatientForExternal(
      id,
      req.apiKey.organizationId,
      format as 'standard' | 'hl7' | 'fhir'
    );
    
    if (!patient) {
      res.status(404).json({
        success: false,
        error: 'Patient not found or access denied',
        timestamp: new Date().toISOString(),
      });
      return;
    }
    
    // Log external access
    logger.info('External patient data access', {
      patientId: id,
      organizationId: req.apiKey.organizationId,
      format,
      ip: req.ip,
    });
    
    res.json({
      success: true,
      data: patient,
      format,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
}

// Helper function to send webhooks
async function sendWebhook(event: string, data: any): Promise<void> {
  try {
    const webhookService = require('../services/webhook.service');
    await webhookService.sendWebhook(event, data);
  } catch (error) {
    logger.error('Failed to send webhook', { event, error });
  }
}