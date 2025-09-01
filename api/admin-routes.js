const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const router = express.Router();

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL || 'http://localhost:54321',
    process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2UiLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
);

// Middleware to verify admin role
async function verifyAdmin(req, res, next) {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) {
            return res.status(401).json({ error: 'No authorization token provided' });
        }

        const { data: { user }, error } = await supabase.auth.getUser(token);
        if (error || !user) {
            return res.status(401).json({ error: 'Invalid token' });
        }

        // Check if user is admin
        const { data: profile } = await supabase
            .from('user_profiles')
            .select('role')
            .eq('id', user.id)
            .single();

        if (profile?.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }

        req.user = user;
        req.userRole = profile.role;
        next();
    } catch (error) {
        console.error('Auth error:', error);
        res.status(500).json({ error: 'Authentication error' });
    }
}

// Get current user data
router.get('/auth/user', verifyAdmin, async (req, res) => {
    try {
        const { data: profile } = await supabase
            .from('user_profiles')
            .select('*')
            .eq('id', req.user.id)
            .single();

        res.json({
            ...req.user,
            ...profile
        });
    } catch (error) {
        console.error('Error fetching user:', error);
        res.status(500).json({ error: 'Failed to fetch user data' });
    }
});

// Get current patient
router.get('/patients/current', verifyAdmin, async (req, res) => {
    try {
        const { data: patient } = await supabase
            .from('patients')
            .select('*')
            .eq('owner_id', req.user.id)
            .single();

        if (!patient) {
            // Return empty patient for new setup
            return res.json(null);
        }

        res.json(patient);
    } catch (error) {
        console.error('Error fetching patient:', error);
        res.status(500).json({ error: 'Failed to fetch patient data' });
    }
});

// Create or update patient
router.post('/patients/new', verifyAdmin, async (req, res) => {
    try {
        const { name, age, condition, address, radius_meters, lat, lng } = req.body;

        const { data: patient, error } = await supabase
            .from('patients')
            .insert({
                owner_id: req.user.id,
                name,
                age,
                condition,
                address,
                radius_meters: radius_meters || 30,
                lat: lat || 0,
                lng: lng || 0
            })
            .select()
            .single();

        if (error) throw error;

        res.json(patient);
    } catch (error) {
        console.error('Error creating patient:', error);
        res.status(500).json({ error: 'Failed to create patient' });
    }
});

router.put('/patients/:id', verifyAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, age, condition, address, radius_meters } = req.body;

        const { data: patient, error } = await supabase
            .from('patients')
            .update({
                name,
                age,
                condition,
                address,
                radius_meters
            })
            .eq('id', id)
            .eq('owner_id', req.user.id) // Ensure user owns this patient
            .select()
            .single();

        if (error) throw error;

        res.json(patient);
    } catch (error) {
        console.error('Error updating patient:', error);
        res.status(500).json({ error: 'Failed to update patient' });
    }
});

// Get recent activities
router.get('/activities/recent', verifyAdmin, async (req, res) => {
    try {
        const activities = [];
        
        // Get recent attendance
        const { data: attendance } = await supabase
            .from('attendance')
            .select(`
                *,
                caregiver:caregiver_id (
                    full_name
                )
            `)
            .order('created_at', { ascending: false })
            .limit(5);

        attendance?.forEach(a => {
            if (a.check_in_time) {
                activities.push({
                    type: 'attendance_check_in',
                    title: `${a.caregiver?.full_name || 'Cuidadora'} ingresó`,
                    description: `A ${a.check_in_distance_meters?.toFixed(0)}m del domicilio`,
                    created_at: a.check_in_time
                });
            }
            if (a.check_out_time) {
                activities.push({
                    type: 'attendance_check_out',
                    title: `${a.caregiver?.full_name || 'Cuidadora'} salió`,
                    description: a.questionnaire_completed ? 'Cuestionario completado' : 'Sin cuestionario',
                    created_at: a.check_out_time
                });
            }
        });

        // Get recent medications
        const { data: medications } = await supabase
            .from('medication_logs')
            .select(`
                *,
                medication:medication_id (
                    name
                ),
                caregiver:given_by (
                    full_name
                )
            `)
            .order('scheduled_time', { ascending: false })
            .limit(5);

        medications?.forEach(m => {
            activities.push({
                type: m.given_at ? 'medication_given' : 'medication_missed',
                title: m.given_at ? 
                    `${m.medication?.name} administrado` : 
                    `${m.medication?.name} NO administrado`,
                description: m.caregiver?.full_name || '',
                created_at: m.given_at || m.scheduled_time
            });
        });

        // Get recent meals
        const { data: meals } = await supabase
            .from('meal_logs')
            .select(`
                *,
                caregiver:logged_by (
                    full_name
                )
            `)
            .order('meal_time', { ascending: false })
            .limit(5);

        meals?.forEach(m => {
            activities.push({
                type: 'meal_recorded',
                title: `${m.meal_type} registrado`,
                description: m.photo_url ? 'Con foto' : m.text_description || 'Sin detalles',
                created_at: m.meal_time
            });
        });

        // Sort all activities by time
        activities.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        res.json(activities.slice(0, 20)); // Return top 20 most recent
    } catch (error) {
        console.error('Error fetching activities:', error);
        res.status(500).json({ error: 'Failed to fetch activities' });
    }
});

// Get all caregivers
router.get('/caregivers', verifyAdmin, async (req, res) => {
    try {
        const { data: patient } = await supabase
            .from('patients')
            .select('id')
            .eq('owner_id', req.user.id)
            .single();

        if (!patient) {
            return res.json([]);
        }

        const { data: caregivers } = await supabase
            .from('user_profiles')
            .select(`
                *,
                access:patient_access!inner (
                    patient_id,
                    access_level
                )
            `)
            .eq('role', 'caregiver')
            .eq('access.patient_id', patient.id);

        res.json(caregivers || []);
    } catch (error) {
        console.error('Error fetching caregivers:', error);
        res.status(500).json({ error: 'Failed to fetch caregivers' });
    }
});

// Get all medications
router.get('/medications', verifyAdmin, async (req, res) => {
    try {
        const { data: patient } = await supabase
            .from('patients')
            .select('id')
            .eq('owner_id', req.user.id)
            .single();

        if (!patient) {
            return res.json([]);
        }

        const { data: medications } = await supabase
            .from('medications')
            .select('*')
            .eq('patient_id', patient.id)
            .order('name');

        res.json(medications || []);
    } catch (error) {
        console.error('Error fetching medications:', error);
        res.status(500).json({ error: 'Failed to fetch medications' });
    }
});

// Add new medication
router.post('/medications', verifyAdmin, async (req, res) => {
    try {
        const { name, dose, frequency, schedule_times, is_critical, notes, patient_id } = req.body;

        // Verify patient ownership
        const { data: patient } = await supabase
            .from('patients')
            .select('id')
            .eq('id', patient_id)
            .eq('owner_id', req.user.id)
            .single();

        if (!patient) {
            return res.status(403).json({ error: 'Patient not found or not authorized' });
        }

        const { data: medication, error } = await supabase
            .from('medications')
            .insert({
                patient_id,
                name,
                dose,
                frequency,
                schedule_times,
                is_critical: is_critical || false,
                notes,
                alert_after_minutes: is_critical ? 10 : 15,
                escalate_after_minutes: is_critical ? 20 : 30
            })
            .select()
            .single();

        if (error) throw error;

        res.json(medication);
    } catch (error) {
        console.error('Error adding medication:', error);
        res.status(500).json({ error: 'Failed to add medication' });
    }
});

// Update medication
router.put('/medications/:id', verifyAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = req.body;

        const { data: medication, error } = await supabase
            .from('medications')
            .update(updateData)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        res.json(medication);
    } catch (error) {
        console.error('Error updating medication:', error);
        res.status(500).json({ error: 'Failed to update medication' });
    }
});

// Delete medication
router.delete('/medications/:id', verifyAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        const { error } = await supabase
            .from('medications')
            .delete()
            .eq('id', id);

        if (error) throw error;

        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting medication:', error);
        res.status(500).json({ error: 'Failed to delete medication' });
    }
});

// Get family members
router.get('/family-members', verifyAdmin, async (req, res) => {
    try {
        const { data: patient } = await supabase
            .from('patients')
            .select('id')
            .eq('owner_id', req.user.id)
            .single();

        if (!patient) {
            return res.json([]);
        }

        const { data: members } = await supabase
            .from('user_profiles')
            .select(`
                *,
                access:patient_access!inner (
                    patient_id,
                    access_level
                )
            `)
            .eq('role', 'observer')
            .eq('access.patient_id', patient.id);

        res.json(members || []);
    } catch (error) {
        console.error('Error fetching family members:', error);
        res.status(500).json({ error: 'Failed to fetch family members' });
    }
});

// Get active alerts
router.get('/alerts/active', verifyAdmin, async (req, res) => {
    try {
        const alerts = [];
        const now = new Date();

        // Check for missed medications
        const { data: missedMeds } = await supabase
            .from('medication_logs')
            .select(`
                *,
                medication:medication_id (
                    name,
                    is_critical
                )
            `)
            .is('given_at', null)
            .lte('scheduled_time', now.toISOString())
            .gte('scheduled_time', new Date(now - 24 * 60 * 60 * 1000).toISOString());

        missedMeds?.forEach(med => {
            const timeDiff = (now - new Date(med.scheduled_time)) / 1000 / 60; // minutes
            
            if (med.medication?.is_critical && timeDiff > 30) {
                alerts.push({
                    priority: 'high',
                    title: 'MEDICAMENTO CRÍTICO PERDIDO',
                    message: `${med.medication.name} debía administrarse hace ${Math.round(timeDiff)} minutos`,
                    action: 'markMedicationGiven',
                    actionText: 'Marcar como dado'
                });
            } else if (timeDiff > 60) {
                alerts.push({
                    priority: 'medium',
                    title: 'Medicamento perdido',
                    message: `${med.medication?.name} debía administrarse hace ${Math.round(timeDiff)} minutos`,
                    action: 'markMedicationGiven',
                    actionText: 'Marcar como dado'
                });
            }
        });

        // Check for caregiver not present
        const { data: todayAttendance } = await supabase
            .from('attendance')
            .select('*')
            .gte('created_at', new Date().toISOString().split('T')[0])
            .single();

        if (!todayAttendance || !todayAttendance.check_in_time) {
            const hour = now.getHours();
            if (hour > 9 && hour < 21) { // Between 9 AM and 9 PM
                alerts.push({
                    priority: 'high',
                    title: 'Sin cuidadora presente',
                    message: 'No hay registro de entrada de ninguna cuidadora hoy'
                });
            }
        }

        // Check for missing daily weight
        const { data: todayWeight } = await supabase
            .from('daily_logs')
            .select('weight')
            .gte('created_at', new Date().toISOString().split('T')[0])
            .single();

        if (!todayWeight?.weight && now.getHours() > 12) {
            alerts.push({
                priority: 'medium',
                title: 'Peso diario pendiente',
                message: 'No se ha registrado el peso del paciente hoy'
            });
        }

        res.json(alerts);
    } catch (error) {
        console.error('Error fetching alerts:', error);
        res.status(500).json({ error: 'Failed to fetch alerts' });
    }
});

// Generate report
router.post('/reports/generate', verifyAdmin, async (req, res) => {
    try {
        const { type, startDate, endDate, format } = req.body;

        // This would integrate with the Python export system
        // For now, return a placeholder
        res.json({
            message: 'Report generation would be implemented here',
            type,
            startDate,
            endDate,
            format
        });
    } catch (error) {
        console.error('Error generating report:', error);
        res.status(500).json({ error: 'Failed to generate report' });
    }
});

// Delete caregiver
router.delete('/caregivers/:id', verifyAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        // Remove patient access first
        await supabase
            .from('patient_access')
            .delete()
            .eq('user_id', id);

        // Deactivate user
        const { error } = await supabase
            .from('user_profiles')
            .update({ is_active: false })
            .eq('id', id);

        if (error) throw error;

        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting caregiver:', error);
        res.status(500).json({ error: 'Failed to delete caregiver' });
    }
});

// Remove family member
router.delete('/family-members/:id', verifyAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        // Remove patient access
        const { error } = await supabase
            .from('patient_access')
            .delete()
            .eq('user_id', id);

        if (error) throw error;

        res.json({ success: true });
    } catch (error) {
        console.error('Error removing family member:', error);
        res.status(500).json({ error: 'Failed to remove family member' });
    }
});

module.exports = router;