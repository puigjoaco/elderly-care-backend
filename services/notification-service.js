// Sistema Completo de Notificaciones Multi-Canal
// Soporta: Email (SendGrid/SMTP), Push (Firebase), SMS (Twilio), WebSocket
require('dotenv').config();
const nodemailer = require('nodemailer');
const sgMail = require('@sendgrid/mail');
const admin = require('firebase-admin');
const { createClient } = require('@supabase/supabase-js');

// Configuración de Supabase
const supabase = createClient(
    process.env.SUPABASE_URL || 'http://localhost:54321',
    process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2UiLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
);

// Configuración de SendGrid (si está disponible)
if (process.env.SENDGRID_API_KEY && process.env.SENDGRID_API_KEY !== 'your_sendgrid_api_key_here') {
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

// Configuración de Nodemailer (alternativa a SendGrid)
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: process.env.SMTP_PORT || 587,
    secure: false,
    auth: {
        user: process.env.SMTP_USER || 'noreply@dementia-care.com',
        pass: process.env.SMTP_PASS || 'demo_password'
    }
});

// Configuración de Firebase Admin (para Push Notifications)
let firebaseAdmin = null;
try {
    if (process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_PRIVATE_KEY !== 'YOUR_PRIVATE_KEY_HERE') {
        firebaseAdmin = admin.initializeApp({
            credential: admin.credential.cert({
                projectId: process.env.FIREBASE_PROJECT_ID,
                clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
            })
        });
        console.log('✅ Firebase Admin SDK initialized');
    }
} catch (error) {
    console.log('⚠️ Firebase Admin SDK not configured:', error.message);
}

// Tipos de notificación y su prioridad
const NOTIFICATION_TYPES = {
    // CRÍTICAS - Notificación inmediata a TODOS
    MEDICATION_CRITICAL_MISSED: {
        priority: 'critical',
        channels: ['push', 'email', 'sms'],
        escalation: [0, 10, 30], // minutos
        title: '🚨 MEDICAMENTO CRÍTICO NO ADMINISTRADO',
        color: '#FF0000'
    },
    CAREGIVER_NOT_ARRIVED: {
        priority: 'critical',
        channels: ['push', 'email', 'sms'],
        escalation: [0, 15, 30],
        title: '🚨 CUIDADORA NO HA LLEGADO',
        color: '#FF0000'
    },
    PATIENT_FALL: {
        priority: 'critical',
        channels: ['push', 'email', 'sms'],
        escalation: [0],
        title: '🚨 CAÍDA DETECTADA',
        color: '#FF0000'
    },
    PANIC_BUTTON: {
        priority: 'critical',
        channels: ['push', 'email', 'sms', 'call'],
        escalation: [0],
        title: '🆘 BOTÓN DE PÁNICO ACTIVADO',
        color: '#FF0000'
    },
    
    // IMPORTANTES - Notificación en 30 minutos
    MEDICATION_REGULAR_MISSED: {
        priority: 'high',
        channels: ['push', 'email'],
        escalation: [15, 30, 60],
        title: '⚠️ Medicamento no administrado',
        color: '#FFA500'
    },
    WEIGHT_NOT_RECORDED: {
        priority: 'high',
        channels: ['push', 'email'],
        escalation: [30],
        title: '⚠️ Peso diario no registrado',
        color: '#FFA500'
    },
    MEAL_MISSED: {
        priority: 'high',
        channels: ['push', 'email'],
        escalation: [30, 60],
        title: '⚠️ Comida no registrada',
        color: '#FFA500'
    },
    QUESTIONNAIRE_INCOMPLETE: {
        priority: 'high',
        channels: ['push', 'email'],
        escalation: [15],
        title: '⚠️ Cuestionario de salida pendiente',
        color: '#FFA500'
    },
    
    // INFORMATIVAS - Resumen diario
    CAREGIVER_CHECKED_IN: {
        priority: 'medium',
        channels: ['push'],
        escalation: [],
        title: '✅ Cuidadora ha llegado',
        color: '#00FF00'
    },
    MEDICATION_GIVEN: {
        priority: 'low',
        channels: ['push'],
        escalation: [],
        title: '💊 Medicamento administrado',
        color: '#00FF00'
    },
    DAILY_SUMMARY: {
        priority: 'low',
        channels: ['email'],
        escalation: [],
        title: '📊 Resumen diario de cuidados',
        color: '#0088FF'
    }
};

class NotificationService {
    constructor() {
        this.pendingNotifications = new Map();
        this.escalationTimers = new Map();
    }

    // Método principal para enviar notificaciones
    async sendNotification(type, data) {
        const config = NOTIFICATION_TYPES[type];
        if (!config) {
            console.error(`Unknown notification type: ${type}`);
            return;
        }

        // Registrar en base de datos
        const notification = await this.saveNotification(type, data, config);

        // Obtener todos los destinatarios
        const recipients = await this.getRecipients(data.patient_id);

        // Enviar por cada canal configurado
        const promises = [];
        
        if (config.channels.includes('email')) {
            promises.push(this.sendEmail(recipients.emails, config, data, notification.id));
        }
        
        if (config.channels.includes('push')) {
            promises.push(this.sendPushNotification(recipients.tokens, config, data, notification.id));
        }
        
        if (config.channels.includes('sms')) {
            promises.push(this.sendSMS(recipients.phones, config, data));
        }

        // Configurar escalación si es necesario
        if (config.escalation && config.escalation.length > 0) {
            this.setupEscalation(notification.id, type, data, config);
        }

        await Promise.all(promises);
        
        return notification;
    }

    // Guardar notificación en base de datos
    async saveNotification(type, data, config) {
        const { data: notification, error } = await supabase
            .from('notifications')
            .insert({
                type,
                priority: config.priority,
                title: config.title,
                message: data.message,
                patient_id: data.patient_id,
                caregiver_id: data.caregiver_id,
                metadata: data.metadata || {},
                channels_sent: config.channels,
                created_at: new Date().toISOString()
            })
            .select()
            .single();

        if (error) {
            console.error('Error saving notification:', error);
        }

        return notification;
    }

    // Obtener destinatarios (TODOS los familiares)
    async getRecipients(patient_id) {
        // Obtener todos los familiares asociados al paciente
        const { data: familyMembers } = await supabase
            .from('patient_access')
            .select(`
                user_id,
                user:user_profiles!inner (
                    email,
                    phone,
                    full_name,
                    push_tokens,
                    notification_preferences
                )
            `)
            .eq('patient_id', patient_id)
            .in('access_level', ['owner', 'observer']);

        const recipients = {
            emails: [],
            phones: [],
            tokens: []
        };

        familyMembers?.forEach(member => {
            if (member.user?.email) {
                recipients.emails.push({
                    email: member.user.email,
                    name: member.user.full_name
                });
            }
            
            if (member.user?.phone) {
                recipients.phones.push(member.user.phone);
            }
            
            if (member.user?.push_tokens) {
                recipients.tokens.push(...member.user.push_tokens);
            }
        });

        return recipients;
    }

    // Enviar Email
    async sendEmail(recipients, config, data, notificationId) {
        if (!recipients || recipients.length === 0) return;

        const emailContent = {
            subject: `${config.title} - ${data.patient_name || 'Paciente'}`,
            html: this.generateEmailHTML(config, data),
            text: this.generateEmailText(config, data)
        };

        // Intentar con SendGrid primero
        if (sgMail && process.env.SENDGRID_API_KEY !== 'your_sendgrid_api_key_here') {
            try {
                const messages = recipients.map(recipient => ({
                    to: recipient.email,
                    from: 'alertas@dementia-care.com',
                    subject: emailContent.subject,
                    text: emailContent.text,
                    html: emailContent.html,
                    personalizations: [{
                        to: [{ email: recipient.email, name: recipient.name }],
                        dynamic_template_data: {
                            notification_id: notificationId,
                            recipient_name: recipient.name,
                            ...data
                        }
                    }]
                }));

                await sgMail.send(messages);
                console.log(`✅ Email sent via SendGrid to ${recipients.length} recipients`);
                return;
            } catch (error) {
                console.error('SendGrid error, falling back to SMTP:', error);
            }
        }

        // Fallback a SMTP
        try {
            for (const recipient of recipients) {
                await transporter.sendMail({
                    from: '"Sistema de Supervisión" <noreply@dementia-care.com>',
                    to: recipient.email,
                    subject: emailContent.subject,
                    text: emailContent.text,
                    html: emailContent.html
                });
            }
            console.log(`✅ Email sent via SMTP to ${recipients.length} recipients`);
        } catch (error) {
            console.error('Error sending email:', error);
        }
    }

    // Generar HTML del email
    generateEmailHTML(config, data) {
        const criticalStyle = config.priority === 'critical' ? 
            'background: #ff0000; color: white;' : 
            config.priority === 'high' ? 
            'background: #ffa500; color: white;' : 
            'background: #0088ff; color: white;';

        return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
        }
        .header {
            ${criticalStyle}
            padding: 20px;
            border-radius: 10px 10px 0 0;
            text-align: center;
        }
        .content {
            background: #f9f9f9;
            padding: 30px;
            border-radius: 0 0 10px 10px;
        }
        .alert-box {
            background: white;
            padding: 20px;
            margin: 20px 0;
            border-left: 5px solid ${config.color};
            border-radius: 5px;
        }
        .button {
            display: inline-block;
            padding: 12px 30px;
            background: #667eea;
            color: white;
            text-decoration: none;
            border-radius: 5px;
            margin: 20px 0;
        }
        .footer {
            margin-top: 30px;
            padding-top: 20px;
            border-top: 1px solid #ddd;
            font-size: 12px;
            color: #666;
        }
        .critical-warning {
            background: #fee;
            border: 2px solid #ff0000;
            padding: 15px;
            border-radius: 5px;
            margin: 20px 0;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>${config.title}</h1>
        <p>Sistema de Supervisión de Cuidados</p>
    </div>
    
    <div class="content">
        ${config.priority === 'critical' ? `
        <div class="critical-warning">
            <strong>⚠️ ATENCIÓN INMEDIATA REQUERIDA</strong>
            <p>Esta es una alerta crítica que requiere su atención inmediata.</p>
        </div>
        ` : ''}
        
        <div class="alert-box">
            <h2>Detalles de la Alerta</h2>
            <p><strong>Paciente:</strong> ${data.patient_name || 'No especificado'}</p>
            <p><strong>Hora:</strong> ${new Date().toLocaleString('es-ES')}</p>
            <p><strong>Mensaje:</strong> ${data.message}</p>
            
            ${data.caregiver_name ? `
            <p><strong>Cuidadora:</strong> ${data.caregiver_name}</p>
            ` : ''}
            
            ${data.location ? `
            <p><strong>Ubicación:</strong> ${data.location}</p>
            ` : ''}
            
            ${data.details ? `
            <h3>Detalles adicionales:</h3>
            <p>${data.details}</p>
            ` : ''}
        </div>
        
        <div style="text-align: center;">
            <a href="${process.env.APP_URL || 'http://localhost:3000'}/admin" class="button">
                Ver Panel de Control
            </a>
        </div>
        
        ${config.priority === 'critical' ? `
        <div class="alert-box">
            <h3>Acciones Recomendadas:</h3>
            <ul>
                <li>Contacte inmediatamente a la cuidadora</li>
                <li>Verifique el estado del paciente</li>
                <li>Si es necesario, acuda al domicilio</li>
                <li>En caso de emergencia, llame al 911</li>
            </ul>
        </div>
        ` : ''}
        
        <div class="footer">
            <p>Este es un mensaje automático del Sistema de Supervisión de Cuidados.</p>
            <p>Por favor, no responda a este correo.</p>
            <p>Para más información, acceda al panel de control o contacte al administrador.</p>
        </div>
    </div>
</body>
</html>`;
    }

    // Generar texto plano del email
    generateEmailText(config, data) {
        return `
${config.title}
${'='.repeat(50)}

SISTEMA DE SUPERVISIÓN DE CUIDADOS

Paciente: ${data.patient_name || 'No especificado'}
Hora: ${new Date().toLocaleString('es-ES')}
Mensaje: ${data.message}

${data.caregiver_name ? `Cuidadora: ${data.caregiver_name}` : ''}
${data.location ? `Ubicación: ${data.location}` : ''}

${data.details || ''}

${config.priority === 'critical' ? `
ATENCIÓN INMEDIATA REQUERIDA
Esta es una alerta crítica que requiere su atención inmediata.

Acciones Recomendadas:
- Contacte inmediatamente a la cuidadora
- Verifique el estado del paciente
- Si es necesario, acuda al domicilio
- En caso de emergencia, llame al 911
` : ''}

Para ver más detalles, acceda al panel de control:
${process.env.APP_URL || 'http://localhost:3000'}/admin

---
Este es un mensaje automático. Por favor, no responda a este correo.
`;
    }

    // Enviar Push Notification (Firebase)
    async sendPushNotification(tokens, config, data, notificationId) {
        if (!firebaseAdmin || !tokens || tokens.length === 0) return;

        const message = {
            notification: {
                title: config.title,
                body: data.message,
                badge: '1',
                sound: config.priority === 'critical' ? 'alarm.mp3' : 'default',
                icon: '/icon-192x192.png',
                color: config.color
            },
            data: {
                notificationId: notificationId.toString(),
                type: data.type,
                patient_id: data.patient_id,
                priority: config.priority,
                click_action: 'FLUTTER_NOTIFICATION_CLICK',
                url: `${process.env.APP_URL}/admin`
            },
            android: {
                priority: config.priority === 'critical' ? 'high' : 'normal',
                notification: {
                    channelId: config.priority === 'critical' ? 'critical_alerts' : 'default',
                    visibility: 'public',
                    vibrateTimingsMillis: config.priority === 'critical' ? 
                        [0, 500, 250, 500, 250, 500] : [0, 250, 250, 250]
                }
            },
            apns: {
                payload: {
                    aps: {
                        alert: {
                            title: config.title,
                            body: data.message
                        },
                        sound: config.priority === 'critical' ? 'critical.caf' : 'default',
                        badge: 1,
                        'content-available': 1
                    }
                },
                headers: {
                    'apns-priority': config.priority === 'critical' ? '10' : '5'
                }
            },
            tokens: tokens
        };

        try {
            const response = await firebaseAdmin.messaging().sendMulticast(message);
            console.log(`✅ Push notification sent: ${response.successCount} success, ${response.failureCount} failed`);
            
            // Remove invalid tokens
            if (response.failureCount > 0) {
                const invalidTokens = [];
                response.responses.forEach((resp, idx) => {
                    if (!resp.success && resp.error?.code === 'messaging/invalid-registration-token') {
                        invalidTokens.push(tokens[idx]);
                    }
                });
                
                if (invalidTokens.length > 0) {
                    await this.removeInvalidTokens(invalidTokens);
                }
            }
        } catch (error) {
            console.error('Error sending push notification:', error);
        }
    }

    // Enviar SMS (Twilio - opcional)
    async sendSMS(phones, config, data) {
        // Implementación de SMS con Twilio si está configurado
        if (!process.env.TWILIO_ACCOUNT_SID || process.env.TWILIO_ACCOUNT_SID === 'your_twilio_account_sid') {
            console.log('⚠️ SMS not configured (Twilio credentials missing)');
            return;
        }

        // Aquí iría la implementación de Twilio
        console.log(`📱 SMS would be sent to ${phones.length} phones`);
    }

    // Sistema de escalación de notificaciones
    setupEscalation(notificationId, type, data, config) {
        const escalationSteps = config.escalation;
        
        escalationSteps.forEach((minutes, index) => {
            if (minutes === 0) return; // Ya enviado
            
            const timerId = setTimeout(async () => {
                // Verificar si el problema fue resuelto
                const { data: notification } = await supabase
                    .from('notifications')
                    .select('resolved')
                    .eq('id', notificationId)
                    .single();

                if (!notification?.resolved) {
                    // Escalar la notificación
                    console.log(`⚠️ Escalating notification ${notificationId} - Step ${index + 1}`);
                    
                    await this.sendNotification(type, {
                        ...data,
                        message: `[ESCALACIÓN ${index + 1}] ${data.message}`,
                        escalation_level: index + 1
                    });
                }
                
                this.escalationTimers.delete(`${notificationId}-${index}`);
            }, minutes * 60 * 1000);

            this.escalationTimers.set(`${notificationId}-${index}`, timerId);
        });
    }

    // Marcar notificación como resuelta
    async markAsResolved(notificationId) {
        await supabase
            .from('notifications')
            .update({ 
                resolved: true, 
                resolved_at: new Date().toISOString() 
            })
            .eq('id', notificationId);

        // Cancelar escalaciones pendientes
        for (const [key, timer] of this.escalationTimers.entries()) {
            if (key.startsWith(`${notificationId}-`)) {
                clearTimeout(timer);
                this.escalationTimers.delete(key);
            }
        }
    }

    // Remover tokens inválidos
    async removeInvalidTokens(tokens) {
        // Aquí se actualizaría la base de datos para remover tokens inválidos
        console.log(`Removing ${tokens.length} invalid tokens`);
    }

    // Enviar resumen diario
    async sendDailySummary(patient_id) {
        // Recopilar estadísticas del día
        const today = new Date().toISOString().split('T')[0];
        
        const { data: stats } = await supabase
            .from('daily_stats')
            .select('*')
            .eq('patient_id', patient_id)
            .eq('date', today)
            .single();

        const { data: medications } = await supabase
            .from('medication_logs')
            .select('*, medication:medication_id(name)')
            .eq('patient_id', patient_id)
            .gte('scheduled_time', `${today}T00:00:00`)
            .lte('scheduled_time', `${today}T23:59:59`);

        const summary = {
            medications_given: medications?.filter(m => m.given_at).length || 0,
            medications_total: medications?.length || 0,
            meals_recorded: stats?.meals_recorded || 0,
            weight: stats?.weight || 'No registrado',
            mood_score: stats?.mood_score || 'No evaluado'
        };

        await this.sendNotification('DAILY_SUMMARY', {
            patient_id,
            patient_name: stats?.patient_name,
            message: `Resumen del día: ${summary.medications_given}/${summary.medications_total} medicamentos, ${summary.meals_recorded} comidas, peso: ${summary.weight}kg`,
            details: JSON.stringify(summary, null, 2)
        });
    }
}

// Crear instancia singleton
const notificationService = new NotificationService();

// Exportar servicio y tipos
module.exports = {
    notificationService,
    NOTIFICATION_TYPES,
    
    // Métodos de conveniencia
    sendCriticalAlert: (type, data) => notificationService.sendNotification(type, data),
    sendHighPriorityAlert: (type, data) => notificationService.sendNotification(type, data),
    sendInfoNotification: (type, data) => notificationService.sendNotification(type, data),
    markAsResolved: (notificationId) => notificationService.markAsResolved(notificationId),
    sendDailySummary: (patient_id) => notificationService.sendDailySummary(patient_id)
};