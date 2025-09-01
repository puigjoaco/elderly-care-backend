// API Endpoints para Notificaciones
const express = require('express');
const router = express.Router();
const { 
    notificationService, 
    NOTIFICATION_TYPES,
    sendCriticalAlert,
    markAsResolved
} = require('../services/notification-service');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL || 'http://localhost:54321',
    process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR7cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2UiLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
);

// Middleware para autenticación
async function authenticate(req, res, next) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
        return res.status(401).json({ error: 'No authorization token' });
    }

    try {
        const { data: { user }, error } = await supabase.auth.getUser(token);
        
        if (error || !user) {
            return res.status(401).json({ error: 'Invalid token' });
        }

        req.user = user;
        next();
    } catch (error) {
        res.status(500).json({ error: 'Authentication error' });
    }
}

// Enviar alerta inmediata (para botón de pánico, etc.)
router.post('/alerts/immediate', authenticate, async (req, res) => {
    try {
        const { type, message, priority, patient_id } = req.body;

        // Validar tipo de notificación
        if (!NOTIFICATION_TYPES[type]) {
            return res.status(400).json({ 
                error: 'Invalid notification type',
                validTypes: Object.keys(NOTIFICATION_TYPES)
            });
        }

        // Obtener información del paciente
        const { data: patient } = await supabase
            .from('patients')
            .select('name, owner_id')
            .eq('id', patient_id)
            .single();

        if (!patient) {
            return res.status(404).json({ error: 'Patient not found' });
        }

        // Enviar notificación
        const notification = await notificationService.sendNotification(type, {
            patient_id,
            patient_name: patient.name,
            message: message || NOTIFICATION_TYPES[type].title,
            caregiver_id: req.user.id,
            timestamp: new Date().toISOString(),
            metadata: {
                sent_by: req.user.email,
                manual_alert: true
            }
        });

        res.json({
            success: true,
            notification_id: notification.id,
            message: 'Alert sent successfully'
        });
    } catch (error) {
        console.error('Error sending immediate alert:', error);
        res.status(500).json({ error: 'Failed to send alert' });
    }
});

// Botón de pánico
router.post('/panic', authenticate, async (req, res) => {
    try {
        const { patient_id, location, message } = req.body;

        // Obtener información del paciente y cuidadora
        const { data: patient } = await supabase
            .from('patients')
            .select('name')
            .eq('id', patient_id)
            .single();

        const { data: caregiver } = await supabase
            .from('user_profiles')
            .select('full_name, phone')
            .eq('id', req.user.id)
            .single();

        // Enviar alerta de pánico
        const notification = await sendCriticalAlert('PANIC_BUTTON', {
            patient_id,
            patient_name: patient?.name,
            caregiver_id: req.user.id,
            caregiver_name: caregiver?.full_name,
            message: message || '🆘 BOTÓN DE PÁNICO ACTIVADO - EMERGENCIA',
            location: location || 'Ubicación no disponible',
            details: `Activado por: ${caregiver?.full_name}\nTeléfono: ${caregiver?.phone}\nHora: ${new Date().toLocaleString('es-ES')}`,
            metadata: {
                panic_type: 'manual',
                coordinates: location,
                activated_by: req.user.id
            }
        });

        // Registrar en log de emergencias
        await supabase
            .from('emergency_logs')
            .insert({
                patient_id,
                caregiver_id: req.user.id,
                type: 'panic_button',
                location,
                message,
                notification_id: notification.id,
                created_at: new Date().toISOString()
            });

        res.json({
            success: true,
            notification_id: notification.id,
            message: 'Emergency alert sent to all family members'
        });
    } catch (error) {
        console.error('Error with panic button:', error);
        res.status(500).json({ error: 'Failed to send emergency alert' });
    }
});

// Obtener historial de notificaciones
router.get('/history', authenticate, async (req, res) => {
    try {
        const { patient_id, priority, resolved, limit = 50 } = req.query;

        let query = supabase
            .from('notifications')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(limit);

        if (patient_id) query = query.eq('patient_id', patient_id);
        if (priority) query = query.eq('priority', priority);
        if (resolved !== undefined) query = query.eq('resolved', resolved === 'true');

        const { data: notifications, error } = await query;

        if (error) throw error;

        res.json({
            success: true,
            notifications: notifications || []
        });
    } catch (error) {
        console.error('Error fetching notification history:', error);
        res.status(500).json({ error: 'Failed to fetch notifications' });
    }
});

// Marcar notificación como resuelta
router.put('/:id/resolve', authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        const { resolution_notes } = req.body;

        // Marcar como resuelta
        await markAsResolved(id);

        // Actualizar con notas de resolución
        await supabase
            .from('notifications')
            .update({
                resolution_notes,
                resolved_by: req.user.id,
                resolved_at: new Date().toISOString()
            })
            .eq('id', id);

        res.json({
            success: true,
            message: 'Notification marked as resolved'
        });
    } catch (error) {
        console.error('Error resolving notification:', error);
        res.status(500).json({ error: 'Failed to resolve notification' });
    }
});

// Test de notificaciones (solo desarrollo)
router.post('/test', authenticate, async (req, res) => {
    if (process.env.NODE_ENV === 'production') {
        return res.status(403).json({ error: 'Test endpoint disabled in production' });
    }

    try {
        const { type = 'MEDICATION_REGULAR_MISSED', patient_id = '123' } = req.body;

        const notification = await notificationService.sendNotification(type, {
            patient_id,
            patient_name: 'Paciente de Prueba',
            message: 'Esta es una notificación de prueba',
            caregiver_id: req.user.id,
            metadata: {
                test: true,
                timestamp: new Date().toISOString()
            }
        });

        res.json({
            success: true,
            notification,
            message: 'Test notification sent'
        });
    } catch (error) {
        console.error('Error sending test notification:', error);
        res.status(500).json({ error: 'Failed to send test notification' });
    }
});

// Configuración de preferencias de notificación
router.put('/preferences', authenticate, async (req, res) => {
    try {
        const { 
            push_enabled,
            email_enabled,
            sms_enabled,
            quiet_hours_start,
            quiet_hours_end,
            critical_override_quiet
        } = req.body;

        const { error } = await supabase
            .from('user_profiles')
            .update({
                notification_preferences: {
                    push_enabled: push_enabled !== false,
                    email_enabled: email_enabled !== false,
                    sms_enabled: sms_enabled !== false,
                    quiet_hours_start,
                    quiet_hours_end,
                    critical_override_quiet: critical_override_quiet !== false
                }
            })
            .eq('id', req.user.id);

        if (error) throw error;

        res.json({
            success: true,
            message: 'Notification preferences updated'
        });
    } catch (error) {
        console.error('Error updating preferences:', error);
        res.status(500).json({ error: 'Failed to update preferences' });
    }
});

// Registrar token de dispositivo para push notifications
router.post('/register-device', authenticate, async (req, res) => {
    try {
        const { token, device_type, device_id } = req.body;

        if (!token) {
            return res.status(400).json({ error: 'Device token required' });
        }

        // Obtener tokens actuales del usuario
        const { data: profile } = await supabase
            .from('user_profiles')
            .select('push_tokens')
            .eq('id', req.user.id)
            .single();

        const currentTokens = profile?.push_tokens || [];
        
        // Agregar nuevo token si no existe
        if (!currentTokens.includes(token)) {
            currentTokens.push(token);
        }

        // Actualizar tokens
        await supabase
            .from('user_profiles')
            .update({
                push_tokens: currentTokens,
                last_device_type: device_type,
                last_device_id: device_id
            })
            .eq('id', req.user.id);

        res.json({
            success: true,
            message: 'Device registered for push notifications'
        });
    } catch (error) {
        console.error('Error registering device:', error);
        res.status(500).json({ error: 'Failed to register device' });
    }
});

// Obtener estadísticas de notificaciones
router.get('/stats', authenticate, async (req, res) => {
    try {
        const { patient_id, days = 7 } = req.query;
        
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - parseInt(days));

        let query = supabase
            .from('notifications')
            .select('priority, resolved, created_at')
            .gte('created_at', startDate.toISOString());

        if (patient_id) query = query.eq('patient_id', patient_id);

        const { data: notifications } = await query;

        // Calcular estadísticas
        const stats = {
            total: notifications?.length || 0,
            by_priority: {
                critical: 0,
                high: 0,
                medium: 0,
                low: 0
            },
            resolved: 0,
            unresolved: 0,
            average_resolution_time: 0
        };

        notifications?.forEach(n => {
            stats.by_priority[n.priority]++;
            if (n.resolved) {
                stats.resolved++;
            } else {
                stats.unresolved++;
            }
        });

        res.json({
            success: true,
            stats,
            period_days: days
        });
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({ error: 'Failed to fetch statistics' });
    }
});

module.exports = router;