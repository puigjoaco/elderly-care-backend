const sgMail = require('@sendgrid/mail');
require('dotenv').config();

/**
 * Servicio de notificaciones por email usando SendGrid
 * CRÍTICO: Implementa requisito "SIEMPRE notificar a TODOS los familiares"
 */
class SendGridService {
  constructor() {
    // Configurar API key de SendGrid
    sgMail.setApiKey(process.env.SENDGRID_API_KEY || '');
    this.fromEmail = process.env.SENDGRID_FROM_EMAIL || 'notificaciones@elderly-care.com';
    this.criticalTemplate = process.env.SENDGRID_CRITICAL_TEMPLATE_ID;
    this.importantTemplate = process.env.SENDGRID_IMPORTANT_TEMPLATE_ID;
    this.infoTemplate = process.env.SENDGRID_INFO_TEMPLATE_ID;
  }

  /**
   * Envía notificación crítica a TODOS los familiares
   * NUNCA debe fallar - tiene reintentos automáticos
   */
  async sendCriticalAlert(familyMembers, alertData) {
    const {
      patientName,
      alertType,
      description,
      timestamp,
      location,
      caregiverName,
      actionRequired
    } = alertData;

    // Preparar emails para TODOS los familiares
    const emails = familyMembers.map(member => ({
      to: member.email,
      from: this.fromEmail,
      subject: `🚨 ALERTA CRÍTICA - ${patientName} - ACCIÓN REQUERIDA`,
      templateId: this.criticalTemplate,
      dynamicTemplateData: {
        recipientName: member.full_name,
        patientName,
        alertType,
        description,
        timestamp: new Date(timestamp).toLocaleString('es-ES'),
        location: location ? `${location.address || 'Sin dirección'}` : 'Ubicación desconocida',
        caregiverName: caregiverName || 'No asignada',
        actionRequired,
        dashboardUrl: `${process.env.FRONTEND_URL}/dashboard`,
        emergencyPhone: process.env.EMERGENCY_PHONE || '911'
      },
      // Configuración para alta prioridad
      mailSettings: {
        sandboxMode: {
          enable: false
        }
      },
      trackingSettings: {
        clickTracking: {
          enable: true
        },
        openTracking: {
          enable: true
        }
      }
    }));

    // Si no hay template, usar HTML directo
    if (!this.criticalTemplate) {
      emails.forEach(email => {
        delete email.templateId;
        email.html = this.generateCriticalAlertHTML(email.dynamicTemplateData);
      });
    }

    // Enviar a TODOS con reintentos
    const results = await this.sendWithRetry(emails, 3);
    
    // Log de auditoría
    console.log(`[CRITICAL ALERT] Enviado a ${results.successful.length}/${familyMembers.length} familiares`);
    
    if (results.failed.length > 0) {
      console.error('[CRITICAL ALERT] Falló envío a:', results.failed);
      // Aquí se podría implementar un sistema de notificación alternativo
      await this.notifyAdminOfFailure(results.failed, alertData);
    }

    return results;
  }

  /**
   * Envía notificación importante (30 min timeout)
   */
  async sendImportantNotification(familyMembers, notificationData) {
    const {
      patientName,
      notificationType,
      description,
      timestamp,
      caregiverName
    } = notificationData;

    const emails = familyMembers.map(member => ({
      to: member.email,
      from: this.fromEmail,
      subject: `⚠️ Notificación Importante - ${patientName}`,
      templateId: this.importantTemplate,
      dynamicTemplateData: {
        recipientName: member.full_name,
        patientName,
        notificationType,
        description,
        timestamp: new Date(timestamp).toLocaleString('es-ES'),
        caregiverName: caregiverName || 'No asignada',
        dashboardUrl: `${process.env.FRONTEND_URL}/dashboard`
      }
    }));

    if (!this.importantTemplate) {
      emails.forEach(email => {
        delete email.templateId;
        email.html = this.generateImportantNotificationHTML(email.dynamicTemplateData);
      });
    }

    return await this.sendWithRetry(emails, 2);
  }

  /**
   * Envía resumen diario a todos los familiares
   */
  async sendDailySummary(familyMembers, summaryData) {
    const {
      patientName,
      date,
      medicationsTaken,
      medicationsMissed,
      mealsCompleted,
      activitiesCompleted,
      photosCount,
      weight,
      highlights,
      concerns
    } = summaryData;

    const emails = familyMembers.map(member => ({
      to: member.email,
      from: this.fromEmail,
      subject: `📊 Resumen Diario - ${patientName} - ${date}`,
      templateId: this.infoTemplate,
      dynamicTemplateData: {
        recipientName: member.full_name,
        patientName,
        date,
        medicationsTaken,
        medicationsMissed,
        mealsCompleted,
        activitiesCompleted,
        photosCount,
        weight: weight ? `${weight} kg` : 'No registrado',
        highlights: highlights || [],
        concerns: concerns || [],
        dashboardUrl: `${process.env.FRONTEND_URL}/dashboard`
      }
    }));

    if (!this.infoTemplate) {
      emails.forEach(email => {
        delete email.templateId;
        email.html = this.generateDailySummaryHTML(email.dynamicTemplateData);
      });
    }

    return await this.sendWithRetry(emails, 1);
  }

  /**
   * Envía credenciales de acceso a nuevo usuario
   */
  async sendCredentials(userEmail, credentials) {
    const { fullName, email, password, role, adminName } = credentials;

    const msg = {
      to: userEmail,
      from: this.fromEmail,
      subject: '🔐 Credenciales de Acceso - Sistema de Supervisión de Cuidados',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 10px 10px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
            .credentials { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #667eea; }
            .button { display: inline-block; padding: 12px 24px; background: #667eea; color: white; text-decoration: none; border-radius: 5px; margin-top: 20px; }
            .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
            .warning { background: #fff3cd; border: 1px solid #ffc107; padding: 15px; border-radius: 5px; margin-top: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Bienvenido/a al Sistema de Supervisión de Cuidados</h1>
            </div>
            <div class="content">
              <p>Hola <strong>${fullName}</strong>,</p>
              
              <p>Has sido registrado/a en nuestro sistema por ${adminName} con el rol de <strong>${this.getRoleSpanish(role)}</strong>.</p>
              
              <div class="credentials">
                <h3>Tus credenciales de acceso son:</h3>
                <p><strong>Email:</strong> ${email}</p>
                <p><strong>Contraseña temporal:</strong> ${password}</p>
              </div>
              
              <div class="warning">
                <strong>⚠️ Importante:</strong>
                <ul>
                  <li>Por seguridad, cambia tu contraseña en el primer inicio de sesión</li>
                  <li>No compartas estas credenciales con nadie</li>
                  <li>Si no solicitaste este acceso, contacta inmediatamente al administrador</li>
                </ul>
              </div>
              
              <p>Para acceder al sistema:</p>
              <ol>
                <li>Visita ${process.env.FRONTEND_URL || 'https://elderly-care.app'}</li>
                <li>Ingresa tu email y contraseña</li>
                <li>Sigue las instrucciones para cambiar tu contraseña</li>
              </ol>
              
              <a href="${process.env.FRONTEND_URL || 'https://elderly-care.app'}" class="button">Acceder al Sistema</a>
              
              <div class="footer">
                <p>Este es un mensaje automático del Sistema de Supervisión de Cuidados.</p>
                <p>Si necesitas ayuda, contacta al administrador del sistema.</p>
              </div>
            </div>
          </div>
        </body>
        </html>
      `
    };

    try {
      await sgMail.send(msg);
      console.log(`[CREDENTIALS] Enviadas a ${userEmail}`);
      return { success: true };
    } catch (error) {
      console.error('[CREDENTIALS] Error enviando:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Envía emails con reintentos automáticos
   */
  async sendWithRetry(emails, maxRetries = 3) {
    const results = {
      successful: [],
      failed: []
    };

    for (const email of emails) {
      let success = false;
      let lastError = null;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          await sgMail.send(email);
          results.successful.push(email.to);
          success = true;
          break;
        } catch (error) {
          lastError = error;
          console.error(`[EMAIL] Intento ${attempt}/${maxRetries} falló para ${email.to}:`, error.message);
          
          if (attempt < maxRetries) {
            // Esperar antes de reintentar (backoff exponencial)
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
          }
        }
      }

      if (!success) {
        results.failed.push({
          email: email.to,
          error: lastError?.message || 'Unknown error'
        });
      }
    }

    return results;
  }

  /**
   * Notifica al admin cuando fallan notificaciones críticas
   */
  async notifyAdminOfFailure(failedRecipients, originalAlert) {
    const adminEmail = process.env.ADMIN_EMAIL;
    if (!adminEmail) return;

    const msg = {
      to: adminEmail,
      from: this.fromEmail,
      subject: '🔴 FALLO EN SISTEMA DE NOTIFICACIONES CRÍTICAS',
      html: `
        <h2>Fallo en envío de notificaciones críticas</h2>
        <p><strong>Alerta original:</strong> ${originalAlert.alertType}</p>
        <p><strong>Paciente:</strong> ${originalAlert.patientName}</p>
        <p><strong>Descripción:</strong> ${originalAlert.description}</p>
        <h3>Destinatarios que no recibieron la alerta:</h3>
        <ul>
          ${failedRecipients.map(f => `<li>${f.email} - Error: ${f.error}</li>`).join('')}
        </ul>
        <p><strong>ACCIÓN REQUERIDA:</strong> Contactar manualmente a estos familiares.</p>
      `
    };

    try {
      await sgMail.send(msg);
    } catch (error) {
      console.error('[ADMIN NOTIFICATION] Error crítico:', error);
    }
  }

  /**
   * Genera HTML para alerta crítica (fallback)
   */
  generateCriticalAlertHTML(data) {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; margin: 0; padding: 0; }
          .alert-container { background: #dc3545; color: white; padding: 20px; }
          .alert-content { background: white; color: #333; padding: 30px; }
          .alert-header { font-size: 24px; font-weight: bold; margin-bottom: 20px; }
          .alert-details { background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0; }
          .action-required { background: #ffc107; color: #000; padding: 15px; border-radius: 5px; font-weight: bold; }
          .button { display: inline-block; padding: 15px 30px; background: #dc3545; color: white; text-decoration: none; border-radius: 5px; font-weight: bold; }
        </style>
      </head>
      <body>
        <div class="alert-container">
          <h1>🚨 ALERTA CRÍTICA - ACCIÓN INMEDIATA REQUERIDA</h1>
        </div>
        <div class="alert-content">
          <div class="alert-header">
            Paciente: ${data.patientName}
          </div>
          
          <div class="alert-details">
            <p><strong>Tipo de Alerta:</strong> ${data.alertType}</p>
            <p><strong>Descripción:</strong> ${data.description}</p>
            <p><strong>Hora:</strong> ${data.timestamp}</p>
            <p><strong>Ubicación:</strong> ${data.location}</p>
            <p><strong>Cuidadora:</strong> ${data.caregiverName}</p>
          </div>
          
          <div class="action-required">
            ${data.actionRequired}
          </div>
          
          <p style="margin-top: 30px;">
            <a href="${data.dashboardUrl}" class="button">VER EN EL SISTEMA</a>
          </p>
          
          <p style="margin-top: 20px; color: #666;">
            Si no puede acceder al sistema, llame inmediatamente al: <strong>${data.emergencyPhone}</strong>
          </p>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Genera HTML para notificación importante (fallback)
   */
  generateImportantNotificationHTML(data) {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; }
          .header { background: #ffc107; padding: 20px; }
          .content { padding: 30px; background: #f9f9f9; }
          .details { background: white; padding: 20px; border-radius: 5px; margin: 20px 0; }
        </style>
      </head>
      <body>
        <div class="header">
          <h2>⚠️ Notificación Importante</h2>
        </div>
        <div class="content">
          <p>Hola ${data.recipientName},</p>
          
          <div class="details">
            <h3>${data.notificationType}</h3>
            <p><strong>Paciente:</strong> ${data.patientName}</p>
            <p><strong>Descripción:</strong> ${data.description}</p>
            <p><strong>Hora:</strong> ${data.timestamp}</p>
            <p><strong>Cuidadora:</strong> ${data.caregiverName}</p>
          </div>
          
          <p>
            <a href="${data.dashboardUrl}" style="display: inline-block; padding: 10px 20px; background: #007bff; color: white; text-decoration: none; border-radius: 5px;">
              Ver Detalles
            </a>
          </p>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Genera HTML para resumen diario (fallback)
   */
  generateDailySummaryHTML(data) {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; }
          .content { padding: 30px; background: #f9f9f9; }
          .stat-card { background: white; padding: 15px; border-radius: 5px; margin: 10px 0; display: inline-block; width: 45%; margin-right: 5%; }
          .concerns { background: #fff3cd; border: 1px solid #ffc107; padding: 15px; border-radius: 5px; margin: 20px 0; }
          .highlights { background: #d4edda; border: 1px solid #28a745; padding: 15px; border-radius: 5px; margin: 20px 0; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>📊 Resumen Diario - ${data.patientName}</h1>
          <p>${data.date}</p>
        </div>
        
        <div class="content">
          <p>Hola ${data.recipientName},</p>
          
          <p>Aquí está el resumen de hoy para ${data.patientName}:</p>
          
          <div>
            <div class="stat-card">
              <h3>💊 Medicamentos</h3>
              <p>Tomados: ${data.medicationsTaken}</p>
              <p>Perdidos: ${data.medicationsMissed}</p>
            </div>
            
            <div class="stat-card">
              <h3>🍽️ Comidas</h3>
              <p>Completadas: ${data.mealsCompleted}/4</p>
            </div>
            
            <div class="stat-card">
              <h3>📸 Fotos</h3>
              <p>Registradas: ${data.photosCount}</p>
            </div>
            
            <div class="stat-card">
              <h3>⚖️ Peso</h3>
              <p>${data.weight}</p>
            </div>
          </div>
          
          ${data.highlights.length > 0 ? `
            <div class="highlights">
              <h3>✅ Aspectos Positivos</h3>
              <ul>
                ${data.highlights.map(h => `<li>${h}</li>`).join('')}
              </ul>
            </div>
          ` : ''}
          
          ${data.concerns.length > 0 ? `
            <div class="concerns">
              <h3>⚠️ Puntos de Atención</h3>
              <ul>
                ${data.concerns.map(c => `<li>${c}</li>`).join('')}
              </ul>
            </div>
          ` : ''}
          
          <p style="margin-top: 30px;">
            <a href="${data.dashboardUrl}" style="display: inline-block; padding: 12px 24px; background: #667eea; color: white; text-decoration: none; border-radius: 5px;">
              Ver Reporte Completo
            </a>
          </p>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Traduce rol a español
   */
  getRoleSpanish(role) {
    const roles = {
      'admin': 'Administrador',
      'caregiver': 'Cuidadora',
      'family_observer': 'Familiar Observador'
    };
    return roles[role] || role;
  }
}

module.exports = new SendGridService();