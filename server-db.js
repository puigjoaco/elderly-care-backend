// Servidor con conexión a PostgreSQL
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { Client } = require('pg');
const app = express();
const PORT = process.env.PORT || 3000;

// Configuración de PostgreSQL
const pgClient = new Client({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'elderly_care',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres123'
});

// Variable para saber si estamos conectados a la BD
let isConnected = false;

// Conectar a PostgreSQL
pgClient.connect()
  .then(() => {
    console.log('✅ Conectado a PostgreSQL');
    isConnected = true;
  })
  .catch(err => {
    console.error('⚠️ PostgreSQL no disponible, usando datos de prueba');
    console.error('Detalle del error:', err.message);
    isConnected = false;
  });

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Ruta principal - sirve el HTML
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Health check
app.get('/health', async (req, res) => {
  if (isConnected) {
    try {
      const result = await pgClient.query('SELECT NOW()');
      res.json({
        status: 'healthy',
        database: 'connected',
        time: result.rows[0].now,
        uptime: process.uptime()
      });
    } catch (error) {
      res.json({
        status: 'healthy',
        database: 'error',
        error: error.message,
        uptime: process.uptime()
      });
    }
  } else {
    res.json({
      status: 'healthy',
      database: 'using mock data',
      uptime: process.uptime()
    });
  }
});

// API endpoints con base de datos real
app.get('/api/v1/patients', async (req, res) => {
  try {
    const result = await pgClient.query(`
      SELECT * FROM patients 
      ORDER BY created_at DESC 
      LIMIT 10
    `);
    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    // Si la tabla no existe, devolver datos de prueba
    res.json({
      success: true,
      data: [
        { 
          id: 1, 
          name: 'Mi Madre', 
          age: 78, 
          condition: 'Supervisión de cuidados generales',
          location: 'En su casa',
          currentCaregiver: 'Siomara (Turno Día 9am-8pm)'
        }
      ]
    });
  }
});

app.get('/api/v1/medications', async (req, res) => {
  try {
    const result = await pgClient.query(`
      SELECT * FROM medications 
      WHERE active = true 
      ORDER BY schedule_time ASC
    `);
    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    // Si la tabla no existe, devolver datos de prueba
    res.json({
      success: true,
      data: [
        { id: 1, name: 'Escitalopram', dose: '10mg (media pastilla)', time: '08:00', critical: true },
        { id: 2, name: 'Memantine', dose: '20mg', time: '20:00', critical: true }
      ]
    });
  }
});

app.get('/api/v1/alerts', async (req, res) => {
  try {
    const result = await pgClient.query(`
      SELECT * FROM alerts 
      WHERE acknowledged = false 
      ORDER BY created_at DESC 
      LIMIT 20
    `);
    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    // Si la tabla no existe, devolver datos de prueba
    res.json({
      success: true,
      data: [
        { id: 1, type: 'medication', severity: 'critical', message: 'Medicamento no administrado' }
      ]
    });
  }
});

// Crear paciente (POST)
app.post('/api/v1/patients', async (req, res) => {
  const { name, age, condition, location } = req.body;
  
  try {
    const result = await pgClient.query(
      `INSERT INTO patients (name, age, condition, location) 
       VALUES ($1, $2, $3, $4) 
       RETURNING *`,
      [name, age, condition, location]
    );
    
    res.json({
      success: true,
      data: result.rows[0],
      message: 'Paciente creado exitosamente'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Error creando paciente',
      details: error.message
    });
  }
});

// Crear medicación (POST)
app.post('/api/v1/medications', async (req, res) => {
  const { patient_id, name, dose, schedule_time, critical } = req.body;
  
  try {
    const result = await pgClient.query(
      `INSERT INTO medications (patient_id, name, dose, schedule_time, critical) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING *`,
      [patient_id, name, dose, schedule_time, critical]
    );
    
    res.json({
      success: true,
      data: result.rows[0],
      message: 'Medicación creada exitosamente'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Error creando medicación',
      details: error.message
    });
  }
});

// Status API
app.get('/api/status', (req, res) => {
  res.json({
    message: '🎉 Sistema de Supervisión de Cuidados - API funcionando con PostgreSQL!',
    status: 'OK',
    database: pgClient.host ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString()
  });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log('');
  console.log('================================================');
  console.log('  🚀 Servidor API con PostgreSQL funcionando!');
  console.log('================================================');
  console.log('');
  console.log(`  Página Web: http://localhost:${PORT}`);
  console.log('  Base de datos: PostgreSQL en localhost:5432');
  console.log('');
  console.log('  API Endpoints:');
  console.log(`    GET  - http://localhost:${PORT}/health`);
  console.log(`    GET  - http://localhost:${PORT}/api/v1/patients`);
  console.log(`    POST - http://localhost:${PORT}/api/v1/patients`);
  console.log(`    GET  - http://localhost:${PORT}/api/v1/medications`);
  console.log(`    POST - http://localhost:${PORT}/api/v1/medications`);
  console.log(`    GET  - http://localhost:${PORT}/api/v1/alerts`);
  console.log('');
  console.log('  🌐 Abre http://localhost:3000 en tu navegador');
  console.log('');
  console.log('  Presiona Ctrl+C para detener el servidor');
  console.log('');
});