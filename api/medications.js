// Sistema de Medicamentos con Notificaciones Escalonadas
const { createClient } = require('@supabase/supabase-js');
const cron = require('node-cron');

const supabaseUrl = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Almacenar timers de medicamentos activos
const medicationTimers = new Map();

// Configurar medicamento
async function configureMedication(req, res) {
  try {
    const {
      patient_id,
      name,
      dose,
      schedule_time, // "08:00", "14:00", "20:00"
      critical,
      reminder_before_minutes,
      alert_after_minutes,
      escalate_after_minutes,
      created_by
    } = req.body;

    const { data: medication, error } = await supabase
      .from('medications')
      .insert({
        patient_id,
        name,
        dose,
        schedule_time,
        critical: critical || false,
        reminder_before_minutes: reminder_before_minutes || 10,
        alert_after_minutes: alert_after_minutes || 15,
        escalate_after_minutes: escalate_after_minutes || 30,
        active: true,
        created_by
      })
      .select()
      .single();

    if (error) throw error;

    // Programar recordatorios
    await scheduleMedicationReminders(medication);

    res.json({
      success: true,
      data: medication,
      message: `Medicamento ${name} configurado correctamente`
    });

  } catch (error) {
    console.error('Error configurando medicamento:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

// Administrar medicamento (con foto obligatoria)
async function administerMedication(req, res) {
  try {
    const {
      medication_id,
      caregiver_id,
      photo_base64,
      photo_timestamp,
      photo_hash,
      gps_lat,
      gps_lng
    } = req.body;

    // 1. Verificar que la foto sea válida (usa el sistema anti-fraude)
    const { data: photoValidation } = await supabase
      .from('photo_validations')
      .select('valid')
      .eq('photo_hash', photo_hash)
      .single();

    if (!photoValidation || !photoValidation.valid) {
      return res.status(400).json({
        success: false,
        error: 'FOTO_INVALIDA',
        message: 'La foto del medicamento no es válida'
      });
    }

    // 2. Obtener información del medicamento
    const { data: medication } = await supabase
      .from('medications')
      .select('*, patients(name)')
      .eq('id', medication_id)
      .single();

    // 3. Registrar administración
    const now = new Date();
    const scheduledTime = new Date();
    const [hours, minutes] = medication.schedule_time.split(':');
    scheduledTime.setHours(parseInt(hours), parseInt(minutes), 0);

    const { data: log, error: logError } = await supabase
      .from('medication_logs')
      .insert({
        medication_id,
        caregiver_id,
        scheduled_time: scheduledTime.toISOString(),
        administered_time: now.toISOString(),
        photo_url: `medications/${photo_hash}.jpg`,
        photo_timestamp,
        photo_hash,
        photo_lat: gps_lat,
        photo_lng: gps_lng,
        skipped: false
      })
      .select()
      .single();

    if (logError) throw logError;

    // 4. Cancelar alertas programadas para este medicamento
    const timerKey = `${medication_id}_${scheduledTime.toISOString()}`;
    if (medicationTimers.has(timerKey)) {
      const timers = medicationTimers.get(timerKey);
      timers.forEach(timer => clearTimeout(timer));
      medicationTimers.delete(timerKey);
    }

    // 5. Notificar administración exitosa
    await notifyMedicationStatus(medication.patient_id, {
      type: 'medication',
      severity: 'info',
      title: '✅ Medicamento administrado',
      message: `${medication.name} (${medication.dose}) fue administrado correctamente`
    });

    res.json({
      success: true,
      data: {
        log_id: log.id,
        administered_at: log.administered_time,
        message: 'Medicamento registrado correctamente'
      }
    });

  } catch (error) {
    console.error('Error administrando medicamento:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

// Programar recordatorios y alertas para un medicamento
async function scheduleMedicationReminders(medication) {
  try {
    const [hours, minutes] = medication.schedule_time.split(':');
    
    // Cron job para cada día a la hora del medicamento
    const cronExpression = `${minutes} ${hours} * * *`;
    
    cron.schedule(cronExpression, async () => {
      const today = new Date();
      const scheduledTime = new Date();
      scheduledTime.setHours(parseInt(hours), parseInt(minutes), 0);
      
      // Verificar si ya fue administrado hoy
      const { data: existingLog } = await supabase
        .from('medication_logs')
        .select('id')
        .eq('medication_id', medication.id)
        .gte('scheduled_time', new Date(today.setHours(0, 0, 0, 0)).toISOString())
        .single();

      if (!existingLog) {
        // Programar cadena de notificaciones
        await scheduleNotificationChain(medication, scheduledTime);
      }
    });

    // También programar recordatorio previo
    const reminderMinutes = medication.reminder_before_minutes || 10;
    const reminderHour = parseInt(hours);
    const reminderMin = parseInt(minutes) - reminderMinutes;
    
    if (reminderMin >= 0) {
      const reminderCron = `${reminderMin} ${reminderHour} * * *`;
      
      cron.schedule(reminderCron, async () => {
        // Obtener cuidadora de turno actual
        const { data: currentShift } = await supabase
          .from('attendance')
          .select('caregiver_id, caregivers:users!caregiver_id(name)')
          .eq('patient_id', medication.patient_id)
          .is('check_out_time', null)
          .order('check_in_time', { ascending: false })
          .limit(1)
          .single();

        if (currentShift) {
          // Notificar a la cuidadora
          await supabase.from('notifications').insert({
            user_id: currentShift.caregiver_id,
            type: 'medication',
            severity: 'info',
            title: `⏰ Recordatorio: ${medication.name} en ${reminderMinutes} minutos`,
            message: `Preparar ${medication.name} (${medication.dose}) para administrar a las ${medication.schedule_time}`,
            related_patient_id: medication.patient_id,
            sent_via: { push: true }
          });
        }
      });
    }

  } catch (error) {
    console.error('Error programando recordatorios:', error);
  }
}

// Cadena de notificaciones escalonadas
async function scheduleNotificationChain(medication, scheduledTime) {
  const timerKey = `${medication.id}_${scheduledTime.toISOString()}`;
  const timers = [];

  // 1. A los X minutos: Alerta a cuidadora
  const alertAfterMs = (medication.alert_after_minutes || 15) * 60 * 1000;
  const alertTimer = setTimeout(async () => {
    // Verificar si ya fue administrado
    const { data: log } = await supabase
      .from('medication_logs')
      .select('id')
      .eq('medication_id', medication.id)
      .eq('scheduled_time', scheduledTime.toISOString())
      .single();

    if (!log) {
      // Obtener cuidadora actual
      const { data: currentShift } = await supabase
        .from('attendance')
        .select('caregiver_id')
        .eq('patient_id', medication.patient_id)
        .is('check_out_time', null)
        .order('check_in_time', { ascending: false })
        .limit(1)
        .single();

      if (currentShift) {
        await supabase.from('notifications').insert({
          user_id: currentShift.caregiver_id,
          type: 'medication',
          severity: 'warning',
          title: `⚠️ MEDICAMENTO ATRASADO: ${medication.name}`,
          message: `${medication.name} debió ser administrado hace ${medication.alert_after_minutes} minutos`,
          related_patient_id: medication.patient_id,
          sent_via: { push: true }
        });
      }

      // También notificar a la familia
      await notifyMedicationStatus(medication.patient_id, {
        type: 'medication',
        severity: 'warning',
        title: `⚠️ Medicamento no administrado`,
        message: `${medication.name} lleva ${medication.alert_after_minutes} minutos de retraso`
      });
    }
  }, alertAfterMs);
  timers.push(alertTimer);

  // 2. A los Y minutos: Escalamiento crítico
  const escalateAfterMs = (medication.escalate_after_minutes || 30) * 60 * 1000;
  const escalateTimer = setTimeout(async () => {
    // Verificar nuevamente
    const { data: log } = await supabase
      .from('medication_logs')
      .select('id')
      .eq('medication_id', medication.id)
      .eq('scheduled_time', scheduledTime.toISOString())
      .single();

    if (!log) {
      // ALERTA CRÍTICA a TODOS
      await notifyMedicationStatus(medication.patient_id, {
        type: 'medication',
        severity: 'critical',
        title: `🔴 URGENTE: ${medication.name} NO ADMINISTRADO`,
        message: `CRÍTICO: ${medication.name} lleva ${medication.escalate_after_minutes} minutos sin ser administrado. ${medication.critical ? 'MEDICAMENTO CRÍTICO' : ''}`,
      });

      // Si es medicamento crítico, registrar en auditoría
      if (medication.critical) {
        await supabase.from('security_audit_log').insert({
          action: 'CRITICAL_MEDICATION_MISSED',
          details: {
            medication_id: medication.id,
            medication_name: medication.name,
            scheduled_time: scheduledTime.toISOString(),
            minutes_late: medication.escalate_after_minutes
          },
          blocked: false,
          reason: 'Medicamento crítico no administrado'
        });
      }
    }
  }, escalateAfterMs);
  timers.push(escalateTimer);

  // Guardar timers para poder cancelarlos si se administra
  medicationTimers.set(timerKey, timers);
}

// Obtener medicamentos pendientes
async function getPendingMedications(req, res) {
  try {
    const { patient_id, caregiver_id } = req.query;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Obtener medicamentos activos del paciente
    const { data: medications } = await supabase
      .from('medications')
      .select('*')
      .eq('patient_id', patient_id)
      .eq('active', true)
      .order('schedule_time');

    // Para cada medicamento, verificar si ya fue administrado hoy
    const pendingMeds = [];
    
    for (const med of medications) {
      const [hours, minutes] = med.schedule_time.split(':');
      const scheduledTime = new Date();
      scheduledTime.setHours(parseInt(hours), parseInt(minutes), 0);

      // Verificar si ya fue administrado
      const { data: log } = await supabase
        .from('medication_logs')
        .select('id, administered_time')
        .eq('medication_id', med.id)
        .gte('scheduled_time', today.toISOString())
        .single();

      if (!log) {
        // Calcular estado (próximo, atrasado, crítico)
        const now = new Date();
        const diffMinutes = Math.floor((now - scheduledTime) / 60000);
        
        let status = 'pending';
        if (diffMinutes > med.escalate_after_minutes) {
          status = 'critical';
        } else if (diffMinutes > med.alert_after_minutes) {
          status = 'late';
        } else if (diffMinutes > 0) {
          status = 'overdue';
        }

        pendingMeds.push({
          ...med,
          scheduled_time: scheduledTime.toISOString(),
          status,
          minutes_late: diffMinutes > 0 ? diffMinutes : null
        });
      }
    }

    res.json({
      success: true,
      data: pendingMeds,
      count: pendingMeds.length
    });

  } catch (error) {
    console.error('Error obteniendo medicamentos pendientes:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

// Función auxiliar para notificar estado de medicamentos
async function notifyMedicationStatus(patient_id, notification) {
  try {
    // Obtener configuración de alertas
    const { data: settings } = await supabase
      .from('alert_settings')
      .select('notify_all_family')
      .eq('patient_id', patient_id)
      .single();

    if (settings?.notify_all_family !== false) {
      // Obtener TODOS los familiares
      const { data: familyMembers } = await supabase
        .from('users')
        .select('id')
        .in('role', ['admin', 'observer']);

      if (familyMembers && familyMembers.length > 0) {
        const notifications = familyMembers.map(member => ({
          user_id: member.id,
          type: notification.type,
          severity: notification.severity,
          title: notification.title,
          message: notification.message,
          related_patient_id: patient_id,
          sent_via: { push: true, email: notification.severity === 'critical' }
        }));

        await supabase.from('notifications').insert(notifications);
      }
    }
  } catch (error) {
    console.error('Error enviando notificaciones de medicamento:', error);
  }
}

module.exports = {
  configureMedication,
  administerMedication,
  getPendingMedications,
  scheduleMedicationReminders
};