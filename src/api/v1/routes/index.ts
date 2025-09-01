import { Router } from 'express';
import { authRouter } from './auth.routes';
import { patientsRouter } from './patients.routes';
import { medicationsRouter } from './medications.routes';
import { attendanceRouter } from './attendance.routes';
import { photosRouter } from './photos.routes';
import { alertsRouter } from './alerts.routes';
import { reportsRouter } from './reports.routes';
import { caregiverRouter } from './caregivers.routes';
import { incidentsRouter } from './incidents.routes';
import { vitalsRouter } from './vitals.routes';
import { predictionsRouter } from './predictions.routes';
import { exportsRouter } from './exports.routes';
import { webhooksRouter } from './webhooks.routes';
import { authenticate } from '../middleware/auth';
import { apiKeyAuth } from '../middleware/apiKeyAuth';

const apiV1Router = Router();

// Public routes (no auth required)
apiV1Router.use('/auth', authRouter);
apiV1Router.get('/status', (req, res) => {
  res.json({
    status: 'operational',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// Protected routes (require authentication)
apiV1Router.use('/patients', authenticate, patientsRouter);
apiV1Router.use('/medications', authenticate, medicationsRouter);
apiV1Router.use('/attendance', authenticate, attendanceRouter);
apiV1Router.use('/photos', authenticate, photosRouter);
apiV1Router.use('/alerts', authenticate, alertsRouter);
apiV1Router.use('/reports', authenticate, reportsRouter);
apiV1Router.use('/caregivers', authenticate, caregiverRouter);
apiV1Router.use('/incidents', authenticate, incidentsRouter);
apiV1Router.use('/vitals', authenticate, vitalsRouter);
apiV1Router.use('/predictions', authenticate, predictionsRouter);
apiV1Router.use('/exports', authenticate, exportsRouter);

// API Key authenticated routes (for external systems)
apiV1Router.use('/webhook', apiKeyAuth, webhooksRouter);

// External integration endpoints with API key auth
apiV1Router.get('/external/patients/:id', apiKeyAuth, async (req, res, next) => {
  // External endpoint for medical systems to fetch patient data
  try {
    const patientController = require('../controllers/patients.controller');
    await patientController.getPatientForExternal(req, res);
  } catch (error) {
    next(error);
  }
});

apiV1Router.post('/external/vitals/:patientId', apiKeyAuth, async (req, res, next) => {
  // External endpoint for medical devices to submit vitals
  try {
    const vitalsController = require('../controllers/vitals.controller');
    await vitalsController.createVitalFromExternal(req, res);
  } catch (error) {
    next(error);
  }
});

apiV1Router.get('/external/reports/:patientId', apiKeyAuth, async (req, res, next) => {
  // External endpoint to generate medical reports
  try {
    const reportsController = require('../controllers/reports.controller');
    await reportsController.generateMedicalReport(req, res);
  } catch (error) {
    next(error);
  }
});

export { apiV1Router };