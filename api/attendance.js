// API de Control de Asistencia con GPS
const { createClient } = require('@supabase/supabase-js');

// Configuración de Supabase
const supabaseUrl = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Función para calcular distancia entre dos coordenadas (en metros)
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Radio de la Tierra en metros
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) *
    Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distancia en metros
}

// CHECK-IN: Marcar entrada
async function checkIn(req, res) {
  try {
    const { 
      caregiver_id, 
      patient_id, 
      shift_id,
      lat, 
      lng, 
      photo_base64,
      photo_timestamp 
    } = req.body;

    // 1. Verificar que la foto sea reciente (< 60 segundos)
    const photoTime = new Date(photo_timestamp);
    const now = new Date();
    const timeDiff = (now - photoTime) / 1000; // Diferencia en segundos

    if (timeDiff > 60) {
      // Registrar intento de vulneración
      await supabase.from('security_audit_log').insert({
        user_id: caregiver_id,
        action: 'CHECK_IN_OLD_PHOTO',
        details: { timeDiff, photo_timestamp },
        blocked: true,
        reason: `Foto con ${timeDiff} segundos de antigüedad (máximo 60)`
      });

      return res.status(400).json({
        success: false,
        error: 'FOTO_NO_VALIDA',
        message: 'La foto debe ser tomada en tiempo real (máximo 60 segundos)'
      });
    }

    // 2. Obtener ubicación del paciente
    const { data: patient, error: patientError } = await supabase
      .from('patients')
      .select('lat, lng, radius_meters, name')
      .eq('id', patient_id)
      .single();

    if (patientError || !patient) {
      return res.status(404).json({
        success: false,
        error: 'Paciente no encontrado'
      });
    }

    // 3. Verificar distancia (debe estar dentro del radio)
    const distance = calculateDistance(lat, lng, patient.lat, patient.lng);
    const maxRadius = patient.radius_meters || 30;

    if (distance > maxRadius) {
      // Registrar intento de marcar desde lejos
      await supabase.from('security_audit_log').insert({
        user_id: caregiver_id,
        action: 'CHECK_IN_OUTSIDE_RADIUS',
        details: { 
          distance, 
          maxRadius, 
          caregiver_location: { lat, lng },
          patient_location: { lat: patient.lat, lng: patient.lng }
        },
        blocked: true,
        reason: `Distancia: ${distance.toFixed(0)}m (máximo ${maxRadius}m)`
      });

      // Notificar a todos los familiares
      await notifyAllFamily(patient_id, {
        type: 'attendance',
        severity: 'critical',
        title: '⚠️ Intento de marcar asistencia desde lejos',
        message: `La cuidadora intentó marcar entrada estando a ${distance.toFixed(0)}m de la casa (máximo permitido: ${maxRadius}m)`
      });

      return res.status(400).json({
        success: false,
        error: 'FUERA_DE_RANGO',
        message: `Debes estar a menos de ${maxRadius}m de la casa del paciente. Distancia actual: ${distance.toFixed(0)}m`
      });
    }

    // 4. TODO: Subir foto a storage (implementar después)
    const photoUrl = `temp_photo_${Date.now()}.jpg`; // Temporal

    // 5. Registrar entrada
    const { data: attendance, error: attendanceError } = await supabase
      .from('attendance')
      .insert({
        shift_id,
        caregiver_id,
        patient_id,
        check_in_time: new Date().toISOString(),
        check_in_lat: lat,
        check_in_lng: lng,
        check_in_photo_url: photoUrl,
        check_in_distance_meters: distance
      })
      .select()
      .single();

    if (attendanceError) {
      throw attendanceError;
    }

    // 6. Notificar a familiares que la cuidadora llegó
    await notifyAllFamily(patient_id, {
      type: 'attendance',
      severity: 'info',
      title: '✅ Cuidadora llegó',
      message: `La cuidadora marcó entrada correctamente a ${distance.toFixed(0)}m de la casa`
    });

    res.json({
      success: true,
      data: {
        attendance_id: attendance.id,
        check_in_time: attendance.check_in_time,
        distance: distance.toFixed(0),
        message: 'Entrada registrada correctamente'
      }
    });

  } catch (error) {
    console.error('Error en check-in:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

// CHECK-OUT: Marcar salida (requiere cuestionario)
async function checkOut(req, res) {
  try {
    const {
      attendance_id,
      caregiver_id,
      patient_id,
      lat,
      lng,
      photo_base64,
      photo_timestamp,
      questionnaire // Cuestionario obligatorio
    } = req.body;

    // 1. Verificar que el cuestionario esté completo
    if (!questionnaire || !questionnaire.patient_weight) {
      return res.status(400).json({
        success: false,
        error: 'CUESTIONARIO_INCOMPLETO',
        message: 'Debes completar el cuestionario de salida antes de marcar salida'
      });
    }

    // 2. Verificar foto reciente
    const photoTime = new Date(photo_timestamp);
    const now = new Date();
    const timeDiff = (now - photoTime) / 1000;

    if (timeDiff > 60) {
      await supabase.from('security_audit_log').insert({
        user_id: caregiver_id,
        action: 'CHECK_OUT_OLD_PHOTO',
        details: { timeDiff, photo_timestamp },
        blocked: true,
        reason: `Foto con ${timeDiff} segundos de antigüedad`
      });

      return res.status(400).json({
        success: false,
        error: 'FOTO_NO_VALIDA',
        message: 'La foto debe ser tomada en tiempo real'
      });
    }

    // 3. Verificar ubicación
    const { data: patient } = await supabase
      .from('patients')
      .select('lat, lng, radius_meters')
      .eq('id', patient_id)
      .single();

    const distance = calculateDistance(lat, lng, patient.lat, patient.lng);
    const maxRadius = patient.radius_meters || 30;

    if (distance > maxRadius) {
      await supabase.from('security_audit_log').insert({
        user_id: caregiver_id,
        action: 'CHECK_OUT_OUTSIDE_RADIUS',
        details: { distance, maxRadius },
        blocked: true,
        reason: `Distancia: ${distance.toFixed(0)}m`
      });

      return res.status(400).json({
        success: false,
        error: 'FUERA_DE_RANGO',
        message: `Debes estar en la casa para marcar salida`
      });
    }

    // 4. Guardar cuestionario
    const { data: questionnaireData, error: questError } = await supabase
      .from('exit_questionnaires')
      .insert({
        attendance_id,
        caregiver_id,
        patient_id,
        patient_weight: questionnaire.patient_weight,
        weight_photo_url: questionnaire.weight_photo_url || 'temp_weight.jpg',
        patient_mood: questionnaire.patient_mood,
        patient_mobility: questionnaire.patient_mobility,
        meals_given: questionnaire.meals_given || 0,
        medications_given: questionnaire.medications_given || 0,
        hygiene_completed: questionnaire.hygiene_completed || false,
        incidents: questionnaire.incidents,
        observations: questionnaire.observations,
        final_state_photo_url: 'temp_final.jpg'
      })
      .select()
      .single();

    if (questError) {
      throw questError;
    }

    // 5. Actualizar asistencia
    const photoUrl = `temp_checkout_${Date.now()}.jpg`;
    
    const { error: updateError } = await supabase
      .from('attendance')
      .update({
        check_out_time: new Date().toISOString(),
        check_out_lat: lat,
        check_out_lng: lng,
        check_out_photo_url: photoUrl,
        check_out_distance_meters: distance,
        questionnaire_completed: true
      })
      .eq('id', attendance_id);

    if (updateError) {
      throw updateError;
    }

    // 6. Notificar a familiares
    await notifyAllFamily(patient_id, {
      type: 'attendance',
      severity: 'info',
      title: '👋 Cuidadora salió',
      message: `Turno completado. Peso del paciente: ${questionnaire.patient_weight}kg`
    });

    res.json({
      success: true,
      data: {
        check_out_time: new Date().toISOString(),
        questionnaire_id: questionnaireData.id,
        message: 'Salida registrada correctamente'
      }
    });

  } catch (error) {
    console.error('Error en check-out:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

// Función auxiliar para notificar a todos los familiares
async function notifyAllFamily(patient_id, notification) {
  try {
    // Obtener todos los familiares (admin y observadores)
    const { data: familyMembers } = await supabase
      .from('users')
      .select('id, email, name')
      .in('role', ['admin', 'observer']);

    if (familyMembers && familyMembers.length > 0) {
      // Crear notificación para cada familiar
      const notifications = familyMembers.map(member => ({
        user_id: member.id,
        type: notification.type,
        severity: notification.severity,
        title: notification.title,
        message: notification.message,
        related_patient_id: patient_id,
        sent_via: { push: true, email: true }
      }));

      await supabase.from('notifications').insert(notifications);
    }
  } catch (error) {
    console.error('Error enviando notificaciones:', error);
  }
}

module.exports = {
  checkIn,
  checkOut,
  calculateDistance
};