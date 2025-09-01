import swaggerJsdoc from 'swagger-jsdoc';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Dementia Care Tracking System API',
      version: '1.0.0',
      description: `
        REST API for the Dementia Care Tracking System with HIPAA-compliant medical integration.
        
        ## Authentication
        
        This API supports two authentication methods:
        
        1. **JWT Bearer Token** - For user authentication
        2. **API Key** - For external system integration
        
        ## Rate Limiting
        
        - User endpoints: 1000 requests per hour
        - API Key endpoints: Configurable per organization (default 5000/hour)
        
        ## Webhooks
        
        Subscribe to real-time events via webhook endpoints.
        
        ## Medical Standards
        
        - HL7 FHIR compatible data formats available
        - HIPAA compliant data handling
        - End-to-end encryption for all sensitive data
      `,
      contact: {
        name: 'DementiaCare Support',
        email: 'support@dementiacare.com',
        url: 'https://dementiacare.com/support',
      },
      license: {
        name: 'Proprietary',
        url: 'https://dementiacare.com/license',
      },
    },
    servers: [
      {
        url: 'http://localhost:3000/api/v1',
        description: 'Development server',
      },
      {
        url: 'https://api.dementiacare.com/v1',
        description: 'Production server',
      },
      {
        url: 'https://staging-api.dementiacare.com/v1',
        description: 'Staging server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT token obtained from /auth/login endpoint',
        },
        apiKey: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
          description: 'API key for external system integration',
        },
      },
      schemas: {
        Patient: {
          type: 'object',
          required: ['firstName', 'lastName', 'dateOfBirth'],
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
              readOnly: true,
            },
            firstName: {
              type: 'string',
              minLength: 1,
              maxLength: 100,
            },
            lastName: {
              type: 'string',
              minLength: 1,
              maxLength: 100,
            },
            dateOfBirth: {
              type: 'string',
              format: 'date',
            },
            gender: {
              type: 'string',
              enum: ['male', 'female', 'other'],
            },
            bloodType: {
              type: 'string',
              enum: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'],
            },
            allergies: {
              type: 'array',
              items: {
                type: 'string',
              },
            },
            conditions: {
              type: 'array',
              items: {
                type: 'string',
              },
            },
            emergencyContacts: {
              type: 'array',
              items: {
                $ref: '#/components/schemas/EmergencyContact',
              },
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
              readOnly: true,
            },
            updatedAt: {
              type: 'string',
              format: 'date-time',
              readOnly: true,
            },
          },
        },
        EmergencyContact: {
          type: 'object',
          required: ['name', 'relationship', 'phone'],
          properties: {
            name: {
              type: 'string',
            },
            relationship: {
              type: 'string',
              enum: ['spouse', 'child', 'parent', 'sibling', 'friend', 'other'],
            },
            phone: {
              type: 'string',
              pattern: '^[\\+]?[(]?[0-9]{3}[)]?[-\\s\\.]?[0-9]{3}[-\\s\\.]?[0-9]{4,6}$',
            },
            email: {
              type: 'string',
              format: 'email',
            },
            isPrimary: {
              type: 'boolean',
            },
          },
        },
        Medication: {
          type: 'object',
          required: ['name', 'dosage', 'frequency', 'patientId'],
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
              readOnly: true,
            },
            patientId: {
              type: 'string',
              format: 'uuid',
            },
            name: {
              type: 'string',
            },
            genericName: {
              type: 'string',
            },
            dosage: {
              type: 'string',
            },
            frequency: {
              type: 'string',
              enum: ['daily', 'bid', 'tid', 'qid', 'weekly', 'monthly', 'as_needed'],
            },
            route: {
              type: 'string',
              enum: ['oral', 'iv', 'im', 'subcutaneous', 'topical', 'inhaled', 'rectal'],
            },
            startDate: {
              type: 'string',
              format: 'date',
            },
            endDate: {
              type: 'string',
              format: 'date',
            },
            prescribedBy: {
              type: 'string',
            },
            isCritical: {
              type: 'boolean',
              default: false,
            },
            sideEffects: {
              type: 'array',
              items: {
                type: 'string',
              },
            },
            interactions: {
              type: 'array',
              items: {
                type: 'string',
              },
            },
          },
        },
        Vitals: {
          type: 'object',
          required: ['patientId'],
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
              readOnly: true,
            },
            patientId: {
              type: 'string',
              format: 'uuid',
            },
            bloodPressureSystolic: {
              type: 'number',
              minimum: 0,
              maximum: 300,
            },
            bloodPressureDiastolic: {
              type: 'number',
              minimum: 0,
              maximum: 200,
            },
            heartRate: {
              type: 'number',
              minimum: 0,
              maximum: 300,
            },
            respiratoryRate: {
              type: 'number',
              minimum: 0,
              maximum: 100,
            },
            temperature: {
              type: 'number',
              minimum: 30,
              maximum: 45,
              description: 'Temperature in Celsius',
            },
            oxygenSaturation: {
              type: 'number',
              minimum: 0,
              maximum: 100,
            },
            weight: {
              type: 'number',
              minimum: 0,
              description: 'Weight in kg',
            },
            bloodGlucose: {
              type: 'number',
              minimum: 0,
              description: 'Blood glucose in mg/dL',
            },
            recordedAt: {
              type: 'string',
              format: 'date-time',
            },
            recordedBy: {
              type: 'string',
            },
          },
        },
        Photo: {
          type: 'object',
          required: ['patientId', 'category', 'imageUrl'],
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
              readOnly: true,
            },
            patientId: {
              type: 'string',
              format: 'uuid',
            },
            category: {
              type: 'string',
              enum: [
                'weight',
                'morning_medication',
                'afternoon_medication',
                'evening_medication',
                'night_medication',
                'breakfast',
                'lunch',
                'tea',
                'dinner',
                'morning_state',
                'afternoon_state',
                'evening_state',
                'night_state',
                'wound_care',
                'therapy_session',
                'incident',
              ],
            },
            imageUrl: {
              type: 'string',
              format: 'uri',
            },
            thumbnailUrl: {
              type: 'string',
              format: 'uri',
            },
            metadata: {
              type: 'object',
              properties: {
                location: {
                  type: 'object',
                  properties: {
                    latitude: { type: 'number' },
                    longitude: { type: 'number' },
                  },
                },
                deviceInfo: {
                  type: 'object',
                },
                watermark: {
                  type: 'string',
                },
              },
            },
            isVerified: {
              type: 'boolean',
              readOnly: true,
            },
            capturedAt: {
              type: 'string',
              format: 'date-time',
            },
          },
        },
        Alert: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
            },
            patientId: {
              type: 'string',
              format: 'uuid',
            },
            type: {
              type: 'string',
              enum: [
                'medication_missed',
                'medication_critical',
                'attendance_missing',
                'photo_missing',
                'vital_abnormal',
                'incident',
                'emergency',
              ],
            },
            severity: {
              type: 'string',
              enum: ['low', 'medium', 'high', 'critical'],
            },
            title: {
              type: 'string',
            },
            description: {
              type: 'string',
            },
            status: {
              type: 'string',
              enum: ['active', 'acknowledged', 'resolved', 'expired'],
            },
            acknowledgedBy: {
              type: 'string',
            },
            acknowledgedAt: {
              type: 'string',
              format: 'date-time',
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
            },
          },
        },
        WebhookSubscription: {
          type: 'object',
          required: ['url', 'events'],
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
              readOnly: true,
            },
            url: {
              type: 'string',
              format: 'uri',
              description: 'HTTPS endpoint to receive webhooks',
            },
            events: {
              type: 'array',
              items: {
                type: 'string',
                enum: [
                  'patient.created',
                  'patient.updated',
                  'patient.deleted',
                  'medication.missed',
                  'vital.abnormal',
                  'alert.critical',
                  'incident.reported',
                  'lab.results',
                  'appointment.scheduled',
                ],
              },
              minItems: 1,
            },
            secret: {
              type: 'string',
              description: 'Secret key for webhook signature validation',
            },
            active: {
              type: 'boolean',
              default: true,
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
              readOnly: true,
            },
          },
        },
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'string',
            },
            message: {
              type: 'string',
            },
            details: {
              type: 'object',
            },
            timestamp: {
              type: 'string',
              format: 'date-time',
            },
          },
        },
        Success: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
            },
            message: {
              type: 'string',
            },
            data: {
              type: 'object',
            },
          },
        },
      },
      responses: {
        NotFound: {
          description: 'Resource not found',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error',
              },
            },
          },
        },
        Unauthorized: {
          description: 'Unauthorized access',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error',
              },
            },
          },
        },
        BadRequest: {
          description: 'Invalid request',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error',
              },
            },
          },
        },
        ServerError: {
          description: 'Internal server error',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error',
              },
            },
          },
        },
      },
    },
    security: [
      {
        bearerAuth: [],
      },
      {
        apiKey: [],
      },
    ],
    tags: [
      {
        name: 'Authentication',
        description: 'User authentication endpoints',
      },
      {
        name: 'Patients',
        description: 'Patient management endpoints',
      },
      {
        name: 'Medications',
        description: 'Medication tracking endpoints',
      },
      {
        name: 'Vitals',
        description: 'Vital signs monitoring endpoints',
      },
      {
        name: 'Photos',
        description: 'Photo verification endpoints',
      },
      {
        name: 'Alerts',
        description: 'Alert and notification endpoints',
      },
      {
        name: 'Reports',
        description: 'Report generation endpoints',
      },
      {
        name: 'Webhooks',
        description: 'Webhook subscription endpoints',
      },
      {
        name: 'External',
        description: 'External integration endpoints (API Key required)',
      },
    ],
  },
  apis: ['./src/api/v1/routes/*.ts', './src/api/v1/controllers/*.ts'],
};

export const swaggerSpec = swaggerJsdoc(options);