import { Router } from 'express';
import * as patientsController from '../controllers/patients.controller';
import { validateRequest } from '../middleware/validateRequest';
import { authorize } from '../middleware/authorize';
import * as validators from '../validators/patients.validator';
import { cache } from '../middleware/cache';
import { auditLog } from '../middleware/auditLog';

const router = Router();

// GET /api/v1/patients - Get all patients (admin/family only)
router.get(
  '/',
  authorize(['admin', 'family']),
  cache('patients', 300), // Cache for 5 minutes
  auditLog('patients.list'),
  patientsController.getPatients
);

// GET /api/v1/patients/:id - Get single patient
router.get(
  '/:id',
  authorize(['admin', 'family', 'caregiver']),
  validateRequest(validators.getPatientSchema),
  cache('patient', 600),
  auditLog('patients.view'),
  patientsController.getPatient
);

// POST /api/v1/patients - Create new patient (admin only)
router.post(
  '/',
  authorize(['admin']),
  validateRequest(validators.createPatientSchema),
  auditLog('patients.create'),
  patientsController.createPatient
);

// PUT /api/v1/patients/:id - Update patient
router.put(
  '/:id',
  authorize(['admin', 'family']),
  validateRequest(validators.updatePatientSchema),
  auditLog('patients.update'),
  patientsController.updatePatient
);

// DELETE /api/v1/patients/:id - Delete patient (admin only)
router.delete(
  '/:id',
  authorize(['admin']),
  validateRequest(validators.deletePatientSchema),
  auditLog('patients.delete'),
  patientsController.deletePatient
);

// GET /api/v1/patients/:id/summary - Get patient summary
router.get(
  '/:id/summary',
  authorize(['admin', 'family', 'caregiver']),
  cache('patient-summary', 300),
  auditLog('patients.summary'),
  patientsController.getPatientSummary
);

// GET /api/v1/patients/:id/timeline - Get patient timeline
router.get(
  '/:id/timeline',
  authorize(['admin', 'family']),
  validateRequest(validators.getTimelineSchema),
  auditLog('patients.timeline'),
  patientsController.getPatientTimeline
);

// POST /api/v1/patients/:id/emergency-contact - Add emergency contact
router.post(
  '/:id/emergency-contact',
  authorize(['admin', 'family']),
  validateRequest(validators.emergencyContactSchema),
  auditLog('patients.emergency_contact.add'),
  patientsController.addEmergencyContact
);

// GET /api/v1/patients/:id/predictions - Get AI predictions
router.get(
  '/:id/predictions',
  authorize(['admin', 'family']),
  cache('patient-predictions', 3600), // Cache for 1 hour
  auditLog('patients.predictions'),
  patientsController.getPatientPredictions
);

// POST /api/v1/patients/:id/notes - Add clinical note
router.post(
  '/:id/notes',
  authorize(['admin', 'family', 'caregiver']),
  validateRequest(validators.clinicalNoteSchema),
  auditLog('patients.notes.add'),
  patientsController.addClinicalNote
);

export { router as patientsRouter };