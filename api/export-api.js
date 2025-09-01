// API Endpoints para Exportación de Datos
const express = require('express');
const router = express.Router();
const { exportService } = require('../services/export-service');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const fs = require('fs').promises;

const supabase = createClient(
    process.env.SUPABASE_URL || 'http://localhost:54321',
    process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2UiLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
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

        // Verificar rol
        const { data: profile } = await supabase
            .from('user_profiles')
            .select('role')
            .eq('id', user.id)
            .single();

        req.user = user;
        req.userRole = profile?.role;
        next();
    } catch (error) {
        res.status(500).json({ error: 'Authentication error' });
    }
}

// Verificar permisos de acceso al paciente
async function verifyPatientAccess(req, res, next) {
    const { patient_id } = req.body || req.query || req.params;
    
    if (!patient_id) {
        return res.status(400).json({ error: 'Patient ID required' });
    }

    try {
        // Verificar si el usuario tiene acceso a este paciente
        const { data: access } = await supabase
            .from('patient_access')
            .select('access_level')
            .eq('patient_id', patient_id)
            .eq('user_id', req.user.id)
            .single();

        if (!access && req.userRole !== 'admin') {
            // También verificar si es el owner
            const { data: patient } = await supabase
                .from('patients')
                .select('owner_id')
                .eq('id', patient_id)
                .single();

            if (patient?.owner_id !== req.user.id) {
                return res.status(403).json({ error: 'Access denied to this patient' });
            }
        }

        req.patientId = patient_id;
        next();
    } catch (error) {
        console.error('Error verifying access:', error);
        res.status(500).json({ error: 'Access verification failed' });
    }
}

// Generar exportación completa
router.post('/generate', authenticate, verifyPatientAccess, async (req, res) => {
    try {
        const {
            patient_id,
            start_date,
            end_date,
            format = ['pdf', 'excel'], // Formatos por defecto
            include_photos = true,
            include_analysis = true
        } = req.body;

        // Validar fechas
        const startDate = start_date ? new Date(start_date) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const endDate = end_date ? new Date(end_date) : new Date();

        if (startDate > endDate) {
            return res.status(400).json({ error: 'Invalid date range' });
        }

        // Verificar límite de tiempo (máximo 1 año)
        const daysDiff = (endDate - startDate) / (1000 * 60 * 60 * 24);
        if (daysDiff > 365) {
            return res.status(400).json({ 
                error: 'Date range too large. Maximum 365 days allowed.' 
            });
        }

        // Registrar solicitud de exportación
        const { data: exportRequest, error: insertError } = await supabase
            .from('export_requests')
            .insert({
                patient_id,
                requested_by: req.user.id,
                status: 'processing',
                config: {
                    start_date: startDate.toISOString(),
                    end_date: endDate.toISOString(),
                    format,
                    include_photos,
                    include_analysis
                },
                created_at: new Date().toISOString()
            })
            .select()
            .single();

        if (insertError) {
            console.error('Error creating export request:', insertError);
        }

        // Generar exportación
        console.log(`🚀 Starting export for patient ${patient_id}`);
        
        const results = await exportService.exportData(patient_id, {
            startDate,
            endDate,
            format,
            includePhotos: include_photos,
            includeAnalysis: include_analysis
        });

        // Actualizar estado de la solicitud
        if (exportRequest) {
            await supabase
                .from('export_requests')
                .update({
                    status: 'completed',
                    results,
                    completed_at: new Date().toISOString()
                })
                .eq('id', exportRequest.id);
        }

        // Preparar URLs de descarga
        const downloads = {};
        
        if (results.pdf) {
            downloads.pdf = `/api/export/download/${path.basename(results.pdf.filename)}`;
        }
        
        if (results.excel) {
            downloads.excel = `/api/export/download/${path.basename(results.excel.filename)}`;
        }
        
        if (results.csv) {
            downloads.csv = results.csv.map(f => ({
                filename: f.filename,
                url: `/api/export/download/${path.basename(f.filename)}`
            }));
        }
        
        if (results.zip) {
            downloads.zip = `/api/export/download/${path.basename(results.zip.filename)}`;
        }

        res.json({
            success: true,
            message: 'Export generated successfully',
            export_id: exportRequest?.id,
            downloads,
            stats: {
                period_days: daysDiff.toFixed(0),
                formats_generated: format.length,
                include_analysis,
                include_photos
            }
        });
    } catch (error) {
        console.error('Error generating export:', error);
        
        // Actualizar estado de error si existe la solicitud
        if (req.body.export_request_id) {
            await supabase
                .from('export_requests')
                .update({
                    status: 'failed',
                    error: error.message,
                    failed_at: new Date().toISOString()
                })
                .eq('id', req.body.export_request_id);
        }

        res.status(500).json({ 
            error: 'Failed to generate export',
            details: error.message 
        });
    }
});

// Descargar archivo exportado
router.get('/download/:filename', authenticate, async (req, res) => {
    try {
        const { filename } = req.params;
        
        // Validar nombre de archivo (prevenir path traversal)
        if (filename.includes('..') || filename.includes('/')) {
            return res.status(400).json({ error: 'Invalid filename' });
        }

        const filepath = path.join(__dirname, '../../exports', filename);
        
        // Verificar que el archivo existe
        try {
            await fs.access(filepath);
        } catch {
            return res.status(404).json({ error: 'File not found' });
        }

        // Determinar tipo de contenido
        const ext = path.extname(filename).toLowerCase();
        const contentTypes = {
            '.pdf': 'application/pdf',
            '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            '.csv': 'text/csv',
            '.zip': 'application/zip'
        };

        const contentType = contentTypes[ext] || 'application/octet-stream';

        // Configurar headers para descarga
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

        // Enviar archivo
        const fileStream = require('fs').createReadStream(filepath);
        fileStream.pipe(res);
    } catch (error) {
        console.error('Error downloading file:', error);
        res.status(500).json({ error: 'Failed to download file' });
    }
});

// Obtener historial de exportaciones
router.get('/history', authenticate, async (req, res) => {
    try {
        const { patient_id, limit = 20 } = req.query;

        let query = supabase
            .from('export_requests')
            .select(`
                *,
                patient:patient_id (name),
                user:requested_by (full_name, email)
            `)
            .order('created_at', { ascending: false })
            .limit(limit);

        // Filtrar por paciente si se especifica
        if (patient_id) {
            query = query.eq('patient_id', patient_id);
        } else {
            // Si no es admin, solo mostrar sus propias exportaciones
            if (req.userRole !== 'admin') {
                query = query.eq('requested_by', req.user.id);
            }
        }

        const { data: exports, error } = await query;

        if (error) throw error;

        res.json({
            success: true,
            exports: exports || []
        });
    } catch (error) {
        console.error('Error fetching export history:', error);
        res.status(500).json({ error: 'Failed to fetch export history' });
    }
});

// Generar reporte rápido (resumen)
router.post('/quick-report', authenticate, verifyPatientAccess, async (req, res) => {
    try {
        const { patient_id, days = 7 } = req.body;

        const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        const endDate = new Date();

        // Recopilar datos básicos
        const { data: patient } = await supabase
            .from('patients')
            .select('name, age, condition')
            .eq('id', patient_id)
            .single();

        // Estadísticas rápidas
        const { data: medications } = await supabase
            .from('medication_logs')
            .select('given_at, medication_id')
            .eq('patient_id', patient_id)
            .gte('scheduled_time', startDate.toISOString())
            .lte('scheduled_time', endDate.toISOString());

        const { data: attendance } = await supabase
            .from('attendance')
            .select('check_in_time, check_out_time')
            .eq('patient_id', patient_id)
            .gte('created_at', startDate.toISOString());

        const { data: alerts } = await supabase
            .from('notifications')
            .select('priority')
            .eq('patient_id', patient_id)
            .eq('priority', 'critical')
            .gte('created_at', startDate.toISOString());

        // Calcular métricas
        const totalMeds = medications?.length || 0;
        const givenMeds = medications?.filter(m => m.given_at).length || 0;
        const complianceRate = totalMeds > 0 ? ((givenMeds / totalMeds) * 100).toFixed(1) : 0;

        const daysWithCare = new Set(attendance?.map(a => 
            new Date(a.check_in_time).toDateString()
        )).size;

        const quickReport = {
            patient: patient?.name || 'N/A',
            period: `${days} días`,
            generated_at: new Date().toISOString(),
            summary: {
                medication_compliance: `${complianceRate}%`,
                medications_given: `${givenMeds}/${totalMeds}`,
                days_with_care: `${daysWithCare}/${days}`,
                critical_alerts: alerts?.length || 0,
                status: complianceRate >= 90 && daysWithCare >= (days * 0.8) ? 
                    'GOOD' : complianceRate >= 70 ? 'MODERATE' : 'NEEDS_ATTENTION'
            },
            recommendations: []
        };

        // Agregar recomendaciones basadas en los datos
        if (complianceRate < 80) {
            quickReport.recommendations.push('⚠️ Revisar adherencia a medicación');
        }
        if (daysWithCare < days * 0.8) {
            quickReport.recommendations.push('⚠️ Hay días sin registro de cuidadora');
        }
        if (alerts && alerts.length > 5) {
            quickReport.recommendations.push('🚨 Alto número de alertas críticas');
        }

        res.json({
            success: true,
            report: quickReport
        });
    } catch (error) {
        console.error('Error generating quick report:', error);
        res.status(500).json({ error: 'Failed to generate quick report' });
    }
});

// Programar exportación periódica
router.post('/schedule', authenticate, verifyPatientAccess, async (req, res) => {
    try {
        const {
            patient_id,
            frequency = 'monthly', // weekly, monthly, quarterly
            format = ['pdf'],
            recipients = [],
            day_of_week = 1, // Para semanal (1 = Lunes)
            day_of_month = 1 // Para mensual
        } = req.body;

        // Crear programación
        const { data: schedule, error } = await supabase
            .from('export_schedules')
            .insert({
                patient_id,
                created_by: req.user.id,
                frequency,
                format,
                recipients: recipients.length > 0 ? recipients : [req.user.email],
                config: {
                    day_of_week,
                    day_of_month
                },
                active: true,
                created_at: new Date().toISOString(),
                next_run: calculateNextRun(frequency, day_of_week, day_of_month)
            })
            .select()
            .single();

        if (error) throw error;

        res.json({
            success: true,
            message: 'Export schedule created successfully',
            schedule
        });
    } catch (error) {
        console.error('Error creating schedule:', error);
        res.status(500).json({ error: 'Failed to create export schedule' });
    }
});

// Función helper para calcular próxima ejecución
function calculateNextRun(frequency, dayOfWeek, dayOfMonth) {
    const now = new Date();
    let nextRun = new Date();

    switch (frequency) {
        case 'weekly':
            // Calcular próximo día de la semana especificado
            const currentDay = now.getDay();
            const daysUntilTarget = (dayOfWeek - currentDay + 7) % 7 || 7;
            nextRun.setDate(now.getDate() + daysUntilTarget);
            nextRun.setHours(9, 0, 0, 0); // 9 AM
            break;

        case 'monthly':
            // Próximo día del mes especificado
            nextRun.setMonth(now.getMonth() + (now.getDate() > dayOfMonth ? 1 : 0));
            nextRun.setDate(dayOfMonth);
            nextRun.setHours(9, 0, 0, 0);
            break;

        case 'quarterly':
            // Cada 3 meses
            nextRun.setMonth(now.getMonth() + 3);
            nextRun.setDate(1);
            nextRun.setHours(9, 0, 0, 0);
            break;

        default:
            nextRun.setDate(now.getDate() + 30); // Por defecto, 30 días
    }

    return nextRun.toISOString();
}

// Obtener programaciones activas
router.get('/schedules', authenticate, async (req, res) => {
    try {
        const { patient_id } = req.query;

        let query = supabase
            .from('export_schedules')
            .select(`
                *,
                patient:patient_id (name),
                creator:created_by (full_name)
            `)
            .eq('active', true)
            .order('created_at', { ascending: false });

        if (patient_id) {
            query = query.eq('patient_id', patient_id);
        } else if (req.userRole !== 'admin') {
            query = query.eq('created_by', req.user.id);
        }

        const { data: schedules, error } = await query;

        if (error) throw error;

        res.json({
            success: true,
            schedules: schedules || []
        });
    } catch (error) {
        console.error('Error fetching schedules:', error);
        res.status(500).json({ error: 'Failed to fetch export schedules' });
    }
});

// Cancelar programación
router.delete('/schedules/:id', authenticate, async (req, res) => {
    try {
        const { id } = req.params;

        // Verificar que el usuario es el creador o admin
        const { data: schedule } = await supabase
            .from('export_schedules')
            .select('created_by')
            .eq('id', id)
            .single();

        if (!schedule) {
            return res.status(404).json({ error: 'Schedule not found' });
        }

        if (schedule.created_by !== req.user.id && req.userRole !== 'admin') {
            return res.status(403).json({ error: 'Permission denied' });
        }

        // Desactivar programación
        const { error } = await supabase
            .from('export_schedules')
            .update({ 
                active: false,
                cancelled_at: new Date().toISOString(),
                cancelled_by: req.user.id
            })
            .eq('id', id);

        if (error) throw error;

        res.json({
            success: true,
            message: 'Export schedule cancelled successfully'
        });
    } catch (error) {
        console.error('Error cancelling schedule:', error);
        res.status(500).json({ error: 'Failed to cancel export schedule' });
    }
});

module.exports = router;