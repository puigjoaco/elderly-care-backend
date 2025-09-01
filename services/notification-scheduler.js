// Programador de Notificaciones Automáticas
// Verifica medicamentos, comidas, asistencia y genera alertas automáticamente
const cron = require('node-cron');
const { createClient } = require('@supabase/supabase-js');
const { notificationService, NOTIFICATION_TYPES } = require('./notification-service');

// Configuración de Supabase
const supabase = createClient(
    process.env.SUPABASE_URL || 'http://localhost:54321',
    process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2UiLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
);

class NotificationScheduler {
    constructor() {
        this.jobs = new Map();
        this.medicationTimers = new Map();
    }

    // Inicializar todos los cron jobs
    start() {
        console.log('🚀 Starting Notification Scheduler...');

        // Verificar medicamentos cada 5 minutos
        this.jobs.set('medications', cron.schedule('*/5 * * * *', () => {
            this.checkMedications();
        }));

        // Verificar asistencia de cuidadoras cada 15 minutos (de 7am a 10am)
        this.jobs.set('attendance-morning', cron.schedule('*/15 7-10 * * *', () => {
            this.checkMorningAttendance();
        }));

        // Verificar peso diario a las 11am, 2pm y 5pm
        this.jobs.set('weight-check', cron.schedule('0 11,14,17 * * *', () => {
            this.checkDailyWeight();
        }));

        // Verificar comidas en horarios específicos
        this.jobs.set('meal-breakfast', cron.schedule('30 9 * * *', () => {
            this.checkMeal('breakfast', 'Desayuno');
        }));

        this.jobs.set('meal-lunch', cron.schedule('30 14 * * *', () => {
            this.checkMeal('lunch', 'Almuerzo');
        }));

        this.jobs.set('meal-tea', cron.schedule('30 17 * * *', () => {
            this.checkMeal('tea', 'Once');
        }));

        this.jobs.set('meal-dinner', cron.schedule('30 20 * * *', () => {
            this.checkMeal('dinner', 'Cena');
        }));

        // Verificar cuestionario de salida cada 30 minutos después de las 6pm
        this.jobs.set('questionnaire-check', cron.schedule('*/30 18-23 * * *', () => {
            this.checkExitQuestionnaire();
        }));

        // Enviar resumen diario a las 9pm
        this.jobs.set('daily-summary', cron.schedule('0 21 * * *', () => {
            this.sendDailySummaries();
        }));

        // Verificar alertas no resueltas cada 10 minutos
        this.jobs.set('unresolved-alerts', cron.schedule('*/10 * * * *', () => {
            this.checkUnresolvedAlerts();
        }));

        console.log('✅ Notification Scheduler started with', this.jobs.size, 'jobs');
    }

    // Verificar medicamentos pendientes
    async checkMedications() {
        const now = new Date();
        const fifteenMinutesAgo = new Date(now - 15 * 60 * 1000);
        const thirtyMinutesAgo = new Date(now - 30 * 60 * 1000);

        try {
            // Obtener medicamentos que debían darse en los últimos 30 minutos
            const { data: pendingMeds } = await supabase
                .from('medication_logs')
                .select(`
                    *,
                    medication:medication_id (
                        name,
                        is_critical,
                        alert_after_minutes,
                        escalate_after_minutes
                    ),
                    patient:patient_id (
                        id,
                        name,
                        owner_id
                    )
                `)
                .is('given_at', null)
                .lte('scheduled_time', now.toISOString())
                .gte('scheduled_time', thirtyMinutesAgo.toISOString());

            for (const med of pendingMeds || []) {
                const timeDiff = (now - new Date(med.scheduled_time)) / 1000 / 60; // minutos
                const medKey = `${med.id}-${med.scheduled_time}`;

                // Si ya enviamos notificación para este medicamento, verificar escalación
                if (this.medicationTimers.has(medKey)) {
                    const lastAlert = this.medicationTimers.get(medKey);
                    
                    // Escalar si han pasado más minutos desde la última alerta
                    if (med.medication?.is_critical && timeDiff > 30 && lastAlert < 30) {
                        await this.sendMedicationAlert(med, 'critical_escalation');
                        this.medicationTimers.set(medKey, 30);
                    } else if (!med.medication?.is_critical && timeDiff > 60 && lastAlert < 60) {
                        await this.sendMedicationAlert(med, 'escalation');
                        this.medicationTimers.set(medKey, 60);
                    }
                } else {
                    // Primera alerta
                    const alertTime = med.medication?.alert_after_minutes || 15;
                    
                    if (timeDiff >= alertTime) {
                        await this.sendMedicationAlert(med, 'initial');
                        this.medicationTimers.set(medKey, alertTime);
                    }
                }
            }

            // Limpiar timers antiguos
            for (const [key, _] of this.medicationTimers) {
                const [id, time] = key.split('-');
                if (new Date(time) < thirtyMinutesAgo) {
                    this.medicationTimers.delete(key);
                }
            }
        } catch (error) {
            console.error('Error checking medications:', error);
        }
    }

    // Enviar alerta de medicamento
    async sendMedicationAlert(med, alertType) {
        const isCritical = med.medication?.is_critical;
        const timeDiff = Math.round((new Date() - new Date(med.scheduled_time)) / 1000 / 60);
        
        const notificationType = isCritical ? 
            'MEDICATION_CRITICAL_MISSED' : 
            'MEDICATION_REGULAR_MISSED';

        await notificationService.sendNotification(notificationType, {
            patient_id: med.patient_id,
            patient_name: med.patient?.name,
            medication_id: med.id,
            message: `${med.medication.name} debía administrarse hace ${timeDiff} minutos`,
            details: `Hora programada: ${new Date(med.scheduled_time).toLocaleTimeString('es-ES')}`,
            caregiver_id: med.caregiver_id,
            metadata: {
                medication_name: med.medication.name,
                scheduled_time: med.scheduled_time,
                alert_type: alertType,
                minutes_late: timeDiff
            }
        });

        console.log(`⚠️ Medication alert sent: ${med.medication.name} - ${timeDiff} minutes late`);
    }

    // Verificar asistencia matutina
    async checkMorningAttendance() {
        const now = new Date();
        const today = now.toISOString().split('T')[0];
        const hour = now.getHours();

        // Solo verificar entre 8am y 10am
        if (hour < 8 || hour > 10) return;

        try {
            // Obtener todos los pacientes activos
            const { data: patients } = await supabase
                .from('patients')
                .select('id, name, expected_caregiver_time');

            for (const patient of patients || []) {
                // Verificar si hay check-in hoy
                const { data: attendance } = await supabase
                    .from('attendance')
                    .select('id, check_in_time')
                    .eq('patient_id', patient.id)
                    .gte('created_at', `${today}T00:00:00`)
                    .single();

                if (!attendance || !attendance.check_in_time) {
                    const expectedTime = patient.expected_caregiver_time || '08:00';
                    const expectedDate = new Date(`${today}T${expectedTime}`);
                    
                    if (now > expectedDate) {
                        const minutesLate = Math.round((now - expectedDate) / 1000 / 60);
                        
                        // Enviar alerta si han pasado más de 30 minutos
                        if (minutesLate > 30) {
                            await notificationService.sendNotification('CAREGIVER_NOT_ARRIVED', {
                                patient_id: patient.id,
                                patient_name: patient.name,
                                message: `La cuidadora no ha llegado. Debía llegar a las ${expectedTime}`,
                                details: `${minutesLate} minutos de retraso`,
                                metadata: {
                                    expected_time: expectedTime,
                                    minutes_late: minutesLate
                                }
                            });
                            
                            console.log(`🚨 Caregiver not arrived alert for patient ${patient.name}`);
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Error checking morning attendance:', error);
        }
    }

    // Verificar peso diario
    async checkDailyWeight() {
        const today = new Date().toISOString().split('T')[0];

        try {
            const { data: patients } = await supabase
                .from('patients')
                .select('id, name');

            for (const patient of patients || []) {
                // Verificar si se registró peso hoy
                const { data: dailyLog } = await supabase
                    .from('daily_logs')
                    .select('weight')
                    .eq('patient_id', patient.id)
                    .gte('created_at', `${today}T00:00:00`)
                    .single();

                if (!dailyLog || !dailyLog.weight) {
                    await notificationService.sendNotification('WEIGHT_NOT_RECORDED', {
                        patient_id: patient.id,
                        patient_name: patient.name,
                        message: 'El peso diario no ha sido registrado',
                        details: 'Es importante registrar el peso diariamente para monitorear la salud del paciente'
                    });
                    
                    console.log(`⚠️ Weight not recorded alert for patient ${patient.name}`);
                }
            }
        } catch (error) {
            console.error('Error checking daily weight:', error);
        }
    }

    // Verificar comidas
    async checkMeal(mealType, mealName) {
        const today = new Date().toISOString().split('T')[0];

        try {
            const { data: patients } = await supabase
                .from('patients')
                .select('id, name');

            for (const patient of patients || []) {
                // Verificar si se registró esta comida hoy
                const { data: mealLog } = await supabase
                    .from('meal_logs')
                    .select('id')
                    .eq('patient_id', patient.id)
                    .eq('meal_type', mealType)
                    .gte('meal_time', `${today}T00:00:00`)
                    .single();

                if (!mealLog) {
                    await notificationService.sendNotification('MEAL_MISSED', {
                        patient_id: patient.id,
                        patient_name: patient.name,
                        message: `${mealName} no ha sido registrado`,
                        details: `Por favor, registre la comida o indique si el paciente no comió`,
                        metadata: {
                            meal_type: mealType,
                            meal_name: mealName
                        }
                    });
                    
                    console.log(`⚠️ Meal not recorded alert: ${mealName} for patient ${patient.name}`);
                }
            }
        } catch (error) {
            console.error(`Error checking ${mealType}:`, error);
        }
    }

    // Verificar cuestionario de salida
    async checkExitQuestionnaire() {
        const today = new Date().toISOString().split('T')[0];

        try {
            // Buscar cuidadoras que hicieron check-in pero no check-out
            const { data: pendingCheckouts } = await supabase
                .from('attendance')
                .select(`
                    *,
                    caregiver:caregiver_id (
                        full_name,
                        phone
                    ),
                    patient:patient_id (
                        id,
                        name
                    )
                `)
                .gte('check_in_time', `${today}T00:00:00`)
                .is('check_out_time', null)
                .is('questionnaire_completed', false);

            for (const attendance of pendingCheckouts || []) {
                const checkInTime = new Date(attendance.check_in_time);
                const hoursWorked = (new Date() - checkInTime) / 1000 / 60 / 60;

                // Si han trabajado más de 8 horas, enviar recordatorio
                if (hoursWorked > 8) {
                    await notificationService.sendNotification('QUESTIONNAIRE_INCOMPLETE', {
                        patient_id: attendance.patient_id,
                        patient_name: attendance.patient?.name,
                        caregiver_name: attendance.caregiver?.full_name,
                        message: 'Cuestionario de salida pendiente',
                        details: `La cuidadora ${attendance.caregiver?.full_name} no ha completado el cuestionario de salida`,
                        metadata: {
                            attendance_id: attendance.id,
                            hours_worked: Math.round(hoursWorked)
                        }
                    });
                    
                    console.log(`⚠️ Exit questionnaire reminder for ${attendance.caregiver?.full_name}`);
                }
            }
        } catch (error) {
            console.error('Error checking exit questionnaires:', error);
        }
    }

    // Enviar resúmenes diarios
    async sendDailySummaries() {
        try {
            const { data: patients } = await supabase
                .from('patients')
                .select('id');

            for (const patient of patients || []) {
                await notificationService.sendDailySummary(patient.id);
            }
            
            console.log('📊 Daily summaries sent');
        } catch (error) {
            console.error('Error sending daily summaries:', error);
        }
    }

    // Verificar alertas no resueltas
    async checkUnresolvedAlerts() {
        try {
            const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

            const { data: unresolvedAlerts } = await supabase
                .from('notifications')
                .select('*')
                .eq('resolved', false)
                .eq('priority', 'critical')
                .lte('created_at', oneHourAgo.toISOString());

            for (const alert of unresolvedAlerts || []) {
                // Re-enviar alertas críticas no resueltas
                console.log(`🔄 Re-sending unresolved critical alert: ${alert.id}`);
                
                // Aquí se podría implementar lógica adicional de re-envío
                // o escalar a otros contactos de emergencia
            }
        } catch (error) {
            console.error('Error checking unresolved alerts:', error);
        }
    }

    // Detener todos los cron jobs
    stop() {
        for (const [name, job] of this.jobs) {
            job.stop();
            console.log(`Stopped job: ${name}`);
        }
        this.jobs.clear();
        this.medicationTimers.clear();
        console.log('🛑 Notification Scheduler stopped');
    }

    // Programar notificación específica de medicamento
    scheduleMedicationReminder(medication, patientId) {
        if (!medication.schedule_times || medication.schedule_times.length === 0) return;

        medication.schedule_times.forEach(time => {
            const [hours, minutes] = time.split(':');
            const cronExpression = `${minutes} ${hours} * * *`;
            
            const jobName = `med-${medication.id}-${time}`;
            
            if (this.jobs.has(jobName)) {
                this.jobs.get(jobName).stop();
            }

            const job = cron.schedule(cronExpression, async () => {
                // Crear registro de medicamento pendiente
                await supabase
                    .from('medication_logs')
                    .insert({
                        medication_id: medication.id,
                        patient_id: patientId,
                        scheduled_time: new Date().toISOString(),
                        status: 'pending'
                    });

                console.log(`💊 Medication reminder created: ${medication.name} at ${time}`);
            });

            this.jobs.set(jobName, job);
        });
    }
}

// Crear instancia singleton
const scheduler = new NotificationScheduler();

// Exportar scheduler
module.exports = {
    scheduler,
    startScheduler: () => scheduler.start(),
    stopScheduler: () => scheduler.stop(),
    scheduleMedicationReminder: (medication, patientId) => 
        scheduler.scheduleMedicationReminder(medication, patientId)
};