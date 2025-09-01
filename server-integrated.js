// Servidor Integrado con GPS, Fotos y Medicamentos
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Importar APIs
const attendanceAPI = require('./api/attendance');
const photoSecurityAPI = require('./api/photo-security');
const medicationsAPI = require('./api/medications');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuración de Supabase
const supabaseUrl = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Para fotos en base64
app.use(express.static(__dirname));

// ============================================
// RUTAS PRINCIPALES
// ============================================

// Página principal
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index-integrated.html'));
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    services: {
      gps_attendance: 'active',
      photo_security: 'active',
      medication_tracking: 'active',
      notifications: 'active'
    },
    database: 'Supabase',
    timestamp: new Date().toISOString()
  });
});

// ============================================
// 1. GPS ATTENDANCE CONTROL (30m radius)
// ============================================

app.post('/api/attendance/check-in', attendanceAPI.checkIn);
app.post('/api/attendance/check-out', attendanceAPI.checkOut);

// Verificar estado de asistencia actual
app.get('/api/attendance/current/:patient_id', async (req, res) => {
  try {
    const { patient_id } = req.params;
    
    const { data: attendance } = await supabase
      .from('attendance')
      .select(`
        *,
        caregiver:users!caregiver_id(name, phone)
      `)
      .eq('patient_id', patient_id)
      .is('check_out_time', null)
      .order('check_in_time', { ascending: false })
      .limit(1)
      .single();

    res.json({
      success: true,
      data: attendance || null,
      has_active_shift: !!attendance
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// 2. CAMERA-ONLY PHOTO SECURITY
// ============================================

app.post('/api/photos/validate', 
  photoSecurityAPI.verifyAppSource, // Middleware de seguridad
  photoSecurityAPI.validateAndProcessPhoto
);

app.get('/api/photos/verify/:photo_hash', photoSecurityAPI.verifyPhotoIntegrity);

// ============================================
// 3. MEDICATION TRACKING
// ============================================

app.post('/api/medications/configure', medicationsAPI.configureMedication);
app.post('/api/medications/administer', medicationsAPI.administerMedication);
app.get('/api/medications/pending', medicationsAPI.getPendingMedications);

// Obtener historial de medicamentos
app.get('/api/medications/history/:patient_id', async (req, res) => {
  try {
    const { patient_id } = req.params;
    const { date } = req.query; // Fecha opcional
    
    let query = supabase
      .from('medication_logs')
      .select(`
        *,
        medication:medications(name, dose, schedule_time, critical),
        caregiver:users!caregiver_id(name)
      `)
      .eq('medications.patient_id', patient_id)
      .order('scheduled_time', { ascending: false });

    if (date) {
      const startDate = new Date(date);
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(date);
      endDate.setHours(23, 59, 59, 999);
      
      query = query
        .gte('scheduled_time', startDate.toISOString())
        .lte('scheduled_time', endDate.toISOString());
    } else {
      query = query.limit(50);
    }

    const { data, error } = await query;

    if (error) throw error;

    res.json({
      success: true,
      data,
      count: data.length
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// 4. NOTIFICATION SYSTEM
// ============================================

// Obtener notificaciones de un usuario
app.get('/api/notifications/:user_id', async (req, res) => {
  try {
    const { user_id } = req.params;
    
    const { data: notifications, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user_id)
      .eq('read', false)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;

    res.json({
      success: true,
      data: notifications,
      unread_count: notifications.length
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Marcar notificación como leída
app.put('/api/notifications/:notification_id/read', async (req, res) => {
  try {
    const { notification_id } = req.params;
    
    const { error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('id', notification_id);

    if (error) throw error;

    res.json({ success: true, message: 'Notificación marcada como leída' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// 5. PANIC BUTTON
// ============================================

app.post('/api/panic', async (req, res) => {
  try {
    const { user_id, patient_id, message, gps_lat, gps_lng } = req.body;

    // Registrar en auditoría
    await supabase.from('security_audit_log').insert({
      user_id,
      action: 'PANIC_BUTTON_PRESSED',
      details: { message, gps: { lat: gps_lat, lng: gps_lng } },
      blocked: false,
      reason: 'Botón de pánico activado'
    });

    // Notificar a TODOS inmediatamente
    const { data: allUsers } = await supabase
      .from('users')
      .select('id')
      .in('role', ['admin', 'observer']);

    if (allUsers) {
      const notifications = allUsers.map(user => ({
        user_id: user.id,
        type: 'panic',
        severity: 'critical',
        title: '🚨 BOTÓN DE PÁNICO ACTIVADO',
        message: message || 'Se activó el botón de emergencia. Verificar situación INMEDIATAMENTE.',
        related_patient_id: patient_id,
        sent_via: { push: true, email: true, sms: true }
      }));

      await supabase.from('notifications').insert(notifications);
    }

    res.json({
      success: true,
      message: 'Alerta de emergencia enviada a todos los contactos'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// 6. SECURITY AUDIT LOG
// ============================================

app.get('/api/security/audit', async (req, res) => {
  try {
    const { data: logs, error } = await supabase
      .from('security_audit_log')
      .select(`
        *,
        user:users!user_id(name, role)
      `)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) throw error;

    res.json({
      success: true,
      data: logs,
      count: logs.length
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// DEMO DATA SETUP
// ============================================

app.post('/api/demo/setup', async (req, res) => {
  try {
    // Crear usuario admin de demo
    const { data: admin } = await supabase
      .from('users')
      .insert({
        email: 'familia@demo.com',
        phone: '555-0001',
        name: 'Familiar a Cargo',
        role: 'admin'
      })
      .select()
      .single();

    // Crear cuidadora de demo
    const { data: caregiver } = await supabase
      .from('users')
      .insert({
        email: 'siomara@demo.com',
        phone: '555-0002',
        name: 'Siomara',
        role: 'caregiver',
        created_by: admin.id
      })
      .select()
      .single();

    // Crear paciente de demo
    const { data: patient } = await supabase
      .from('patients')
      .insert({
        name: 'Mi Madre',
        age: 78,
        condition: 'Supervisión de cuidados generales',
        address: 'Av. Principal 123, Santiago',
        lat: -33.4489, // Santiago, Chile
        lng: -70.6693,
        radius_meters: 30,
        created_by: admin.id
      })
      .select()
      .single();

    // Crear medicamentos de demo
    const medications = [
      {
        patient_id: patient.id,
        name: 'Escitalopram',
        dose: '10mg (media pastilla)',
        schedule_time: '08:00',
        critical: true,
        reminder_before_minutes: 10,
        alert_after_minutes: 15,
        escalate_after_minutes: 30,
        created_by: admin.id
      },
      {
        patient_id: patient.id,
        name: 'Memantine',
        dose: '20mg',
        schedule_time: '20:00',
        critical: true,
        created_by: admin.id
      }
    ];

    await supabase.from('medications').insert(medications);

    res.json({
      success: true,
      message: 'Datos de demo creados',
      data: {
        admin_id: admin.id,
        caregiver_id: caregiver.id,
        patient_id: patient.id
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// START SERVER
// ============================================

app.listen(PORT, () => {
  console.log('');
  console.log('════════════════════════════════════════════════════════');
  console.log('  🚀 SISTEMA DE SUPERVISIÓN DE CUIDADOS - INTEGRADO');
  console.log('════════════════════════════════════════════════════════');
  console.log('');
  console.log('  🌐 Panel Web: http://localhost:' + PORT);
  console.log('  📊 Supabase Studio: http://127.0.0.1:54323');
  console.log('');
  console.log('  SISTEMAS ACTIVOS:');
  console.log('  ✅ GPS Attendance Control (30m radius)');
  console.log('  ✅ Camera-Only Photo Security');
  console.log('  ✅ Medication Tracking & Alerts');
  console.log('  ✅ Multi-Channel Notifications');
  console.log('');
  console.log('  ENDPOINTS PRINCIPALES:');
  console.log('  POST /api/attendance/check-in');
  console.log('  POST /api/attendance/check-out');
  console.log('  POST /api/photos/validate');
  console.log('  POST /api/medications/administer');
  console.log('  POST /api/panic');
  console.log('');
  console.log('  Presiona Ctrl+C para detener el servidor');
  console.log('════════════════════════════════════════════════════════');
});