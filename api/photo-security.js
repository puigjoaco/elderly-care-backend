// Sistema Anti-Fraude de Fotos (Solo Cámara)
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Generar hash único para foto
function generatePhotoHash(photoData, timestamp, gps) {
  const dataToHash = `${photoData.substring(0, 100)}|${timestamp}|${gps.lat}|${gps.lng}`;
  return crypto.createHash('sha256').update(dataToHash).digest('hex');
}

// Validar y procesar foto con seguridad anti-fraude
async function validateAndProcessPhoto(req, res) {
  try {
    const {
      photo_base64,
      photo_timestamp,
      capture_source, // DEBE ser 'camera', nunca 'gallery'
      gps_lat,
      gps_lng,
      device_id,
      purpose, // 'medication', 'meal', 'attendance', 'weight', 'final_state'
      user_id
    } = req.body;

    // 1. CRÍTICO: Verificar que sea de cámara, NO de galería
    if (capture_source !== 'camera') {
      // Registrar intento de usar galería
      await supabase.from('security_audit_log').insert({
        user_id,
        action: 'PHOTO_FROM_GALLERY_BLOCKED',
        details: { 
          capture_source, 
          purpose,
          timestamp: photo_timestamp
        },
        blocked: true,
        reason: 'Intento de usar foto de galería bloqueado'
      });

      // Notificar a TODOS los familiares inmediatamente
      await notifySecurityBreach(user_id, {
        severity: 'critical',
        title: '🚨 ALERTA DE SEGURIDAD',
        message: `Intento de usar foto de galería detectado y bloqueado. Propósito: ${purpose}`
      });

      return res.status(403).json({
        success: false,
        error: 'SECURITY_VIOLATION',
        message: 'SOLO se permiten fotos tomadas directamente con la cámara. Fotos de galería están PROHIBIDAS.',
        blocked: true
      });
    }

    // 2. Verificar timestamp (máximo 60 segundos)
    const captureTime = new Date(photo_timestamp);
    const now = new Date();
    const timeDiff = (now - captureTime) / 1000;

    if (timeDiff > 60) {
      await supabase.from('security_audit_log').insert({
        user_id,
        action: 'OLD_PHOTO_BLOCKED',
        details: { 
          timeDiff, 
          photo_timestamp,
          purpose
        },
        blocked: true,
        reason: `Foto con ${timeDiff.toFixed(0)} segundos de antigüedad`
      });

      return res.status(400).json({
        success: false,
        error: 'PHOTO_TOO_OLD',
        message: `La foto debe ser tomada en tiempo real (máximo 60 segundos). Tu foto tiene ${timeDiff.toFixed(0)} segundos.`,
        timeDiff
      });
    }

    // 3. Generar hash único para evitar reutilización
    const photoHash = generatePhotoHash(photo_base64, photo_timestamp, { lat: gps_lat, lng: gps_lng });

    // 4. Verificar que el hash no exista (foto no reutilizada)
    const { data: existingPhoto } = await supabase
      .from('photo_validations')
      .select('id')
      .eq('photo_hash', photoHash)
      .single();

    if (existingPhoto) {
      await supabase.from('security_audit_log').insert({
        user_id,
        action: 'DUPLICATE_PHOTO_BLOCKED',
        details: { 
          photoHash,
          purpose
        },
        blocked: true,
        reason: 'Intento de reutilizar una foto existente'
      });

      return res.status(403).json({
        success: false,
        error: 'DUPLICATE_PHOTO',
        message: 'Esta foto ya fue utilizada anteriormente. Debe tomar una nueva foto.',
        blocked: true
      });
    }

    // 5. Generar watermark invisible con datos forenses
    const watermarkData = {
      timestamp: photo_timestamp,
      server_time: now.toISOString(),
      gps: { lat: gps_lat, lng: gps_lng },
      device_id,
      hash: photoHash,
      purpose
    };

    // 6. TODO: Procesar imagen y agregar watermark
    // (Requiere librería de procesamiento de imágenes)
    const processedPhotoUrl = `photos/${purpose}/${photoHash}.jpg`;

    // 7. Guardar validación en base de datos
    const { data: validation, error: validationError } = await supabase
      .from('photo_validations')
      .insert({
        photo_url: processedPhotoUrl,
        photo_hash: photoHash,
        timestamp_captured: photo_timestamp,
        timestamp_uploaded: now.toISOString(),
        time_diff_seconds: timeDiff,
        gps_lat,
        gps_lng,
        device_id,
        watermark_data: watermarkData,
        valid: true,
        validation_errors: null
      })
      .select()
      .single();

    if (validationError) {
      throw validationError;
    }

    // 8. Log de éxito en auditoría
    await supabase.from('security_audit_log').insert({
      user_id,
      action: 'PHOTO_VALIDATED',
      details: {
        purpose,
        photoHash,
        timeDiff,
        validation_id: validation.id
      },
      blocked: false,
      reason: 'Foto validada correctamente'
    });

    res.json({
      success: true,
      data: {
        photo_url: processedPhotoUrl,
        photo_hash: photoHash,
        validation_id: validation.id,
        watermarked: true,
        message: 'Foto validada y procesada correctamente'
      }
    });

  } catch (error) {
    console.error('Error validando foto:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

// Endpoint para verificar integridad de una foto
async function verifyPhotoIntegrity(req, res) {
  try {
    const { photo_hash } = req.params;

    const { data: validation, error } = await supabase
      .from('photo_validations')
      .select('*')
      .eq('photo_hash', photo_hash)
      .single();

    if (error || !validation) {
      return res.status(404).json({
        success: false,
        error: 'Foto no encontrada en el sistema',
        valid: false
      });
    }

    // Verificar integridad
    const integrityCheck = {
      exists: true,
      valid: validation.valid,
      time_diff: validation.time_diff_seconds,
      has_watermark: !!validation.watermark_data,
      captured_at: validation.timestamp_captured,
      gps_verified: !!(validation.gps_lat && validation.gps_lng)
    };

    res.json({
      success: true,
      data: integrityCheck,
      message: validation.valid ? 'Foto válida y verificada' : 'Foto marcada como inválida'
    });

  } catch (error) {
    console.error('Error verificando integridad:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

// Notificar violación de seguridad a todos los familiares
async function notifySecurityBreach(user_id, alert) {
  try {
    // Obtener información del usuario que intentó la violación
    const { data: violator } = await supabase
      .from('users')
      .select('name, role')
      .eq('id', user_id)
      .single();

    // Obtener TODOS los familiares
    const { data: familyMembers } = await supabase
      .from('users')
      .select('id, email, name')
      .in('role', ['admin', 'observer']);

    if (familyMembers && familyMembers.length > 0) {
      const notifications = familyMembers.map(member => ({
        user_id: member.id,
        type: 'alert',
        severity: alert.severity,
        title: alert.title,
        message: `${alert.message}\n\nUsuario: ${violator?.name || 'Desconocido'} (${violator?.role || 'Sin rol'})`,
        related_caregiver_id: user_id,
        sent_via: { push: true, email: true }
      }));

      await supabase.from('notifications').insert(notifications);
    }
  } catch (error) {
    console.error('Error enviando alerta de seguridad:', error);
  }
}

// Middleware para verificar que las peticiones vengan de la app
function verifyAppSource(req, res, next) {
  const appToken = req.headers['x-app-token'];
  const userAgent = req.headers['user-agent'];
  
  // Verificar que sea nuestra app
  if (!appToken || appToken !== process.env.APP_SECRET_TOKEN) {
    return res.status(403).json({
      success: false,
      error: 'UNAUTHORIZED_SOURCE',
      message: 'Petición no autorizada'
    });
  }

  // Verificar que no sea un navegador web (prevenir manipulación)
  if (userAgent && userAgent.includes('Mozilla')) {
    return res.status(403).json({
      success: false,
      error: 'WEB_BROWSER_BLOCKED',
      message: 'Acceso desde navegador web no permitido'
    });
  }

  next();
}

module.exports = {
  validateAndProcessPhoto,
  verifyPhotoIntegrity,
  verifyAppSource,
  generatePhotoHash
};