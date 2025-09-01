-- Schema completo para Sistema de Supervisión de Cuidados

-- Tabla de usuarios (familia admin, familiares observadores, cuidadoras)
CREATE TABLE IF NOT EXISTS users (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(20),
    name VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('admin', 'observer', 'caregiver')),
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabla de pacientes (adultos mayores)
CREATE TABLE IF NOT EXISTS patients (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    age INTEGER NOT NULL,
    condition TEXT,
    address TEXT NOT NULL,
    lat DECIMAL(10, 8) NOT NULL, -- Latitud de la casa
    lng DECIMAL(11, 8) NOT NULL, -- Longitud de la casa
    radius_meters INTEGER DEFAULT 30, -- Radio permitido en metros
    photo_url TEXT,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabla de turnos de cuidadoras
CREATE TABLE IF NOT EXISTS shifts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    caregiver_id UUID REFERENCES users(id) NOT NULL,
    patient_id UUID REFERENCES patients(id) NOT NULL,
    day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Control de asistencia con GPS
CREATE TABLE IF NOT EXISTS attendance (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    shift_id UUID REFERENCES shifts(id) NOT NULL,
    caregiver_id UUID REFERENCES users(id) NOT NULL,
    patient_id UUID REFERENCES patients(id) NOT NULL,
    check_in_time TIMESTAMP,
    check_in_lat DECIMAL(10, 8),
    check_in_lng DECIMAL(11, 8),
    check_in_photo_url TEXT, -- Selfie con paciente
    check_in_distance_meters DECIMAL(10, 2),
    check_out_time TIMESTAMP,
    check_out_lat DECIMAL(10, 8),
    check_out_lng DECIMAL(11, 8),
    check_out_photo_url TEXT,
    check_out_distance_meters DECIMAL(10, 2),
    questionnaire_completed BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Medicamentos configurados
CREATE TABLE IF NOT EXISTS medications (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    patient_id UUID REFERENCES patients(id) NOT NULL,
    name VARCHAR(255) NOT NULL,
    dose VARCHAR(100) NOT NULL,
    schedule_time TIME NOT NULL,
    critical BOOLEAN DEFAULT false,
    reminder_before_minutes INTEGER DEFAULT 10, -- Minutos antes para recordar
    alert_after_minutes INTEGER DEFAULT 15, -- Minutos después para alertar
    escalate_after_minutes INTEGER DEFAULT 30, -- Minutos para escalar
    active BOOLEAN DEFAULT true,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Registro de medicamentos administrados
CREATE TABLE IF NOT EXISTS medication_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    medication_id UUID REFERENCES medications(id) NOT NULL,
    caregiver_id UUID REFERENCES users(id) NOT NULL,
    scheduled_time TIMESTAMP NOT NULL,
    administered_time TIMESTAMP,
    photo_url TEXT NOT NULL, -- Foto de medicina en mano
    photo_timestamp TIMESTAMP NOT NULL, -- Timestamp de la foto
    photo_hash VARCHAR(255) UNIQUE NOT NULL, -- Hash único de la foto
    photo_lat DECIMAL(10, 8),
    photo_lng DECIMAL(11, 8),
    skipped BOOLEAN DEFAULT false,
    skip_reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Registro de comidas con fotos
CREATE TABLE IF NOT EXISTS meal_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    patient_id UUID REFERENCES patients(id) NOT NULL,
    caregiver_id UUID REFERENCES users(id) NOT NULL,
    meal_type VARCHAR(50) NOT NULL CHECK (meal_type IN ('breakfast', 'lunch', 'tea', 'dinner', 'snack')),
    photo_url TEXT NOT NULL,
    photo_timestamp TIMESTAMP NOT NULL,
    photo_hash VARCHAR(255) UNIQUE NOT NULL,
    photo_lat DECIMAL(10, 8),
    photo_lng DECIMAL(11, 8),
    description TEXT,
    date DATE DEFAULT CURRENT_DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Cuestionario de salida
CREATE TABLE IF NOT EXISTS exit_questionnaires (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    attendance_id UUID REFERENCES attendance(id) NOT NULL,
    caregiver_id UUID REFERENCES users(id) NOT NULL,
    patient_id UUID REFERENCES patients(id) NOT NULL,
    -- Preguntas del cuestionario
    patient_weight DECIMAL(5, 2) NOT NULL, -- Peso obligatorio
    weight_photo_url TEXT NOT NULL, -- Foto de la báscula
    patient_mood VARCHAR(50) CHECK (patient_mood IN ('excellent', 'good', 'regular', 'bad', 'very_bad')),
    patient_mobility VARCHAR(50) CHECK (patient_mobility IN ('independent', 'assisted', 'wheelchair', 'bedridden')),
    meals_given INTEGER NOT NULL,
    medications_given INTEGER NOT NULL,
    hygiene_completed BOOLEAN DEFAULT false,
    incidents TEXT,
    observations TEXT,
    final_state_photo_url TEXT NOT NULL, -- Foto final del paciente
    completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Sistema de notificaciones
CREATE TABLE IF NOT EXISTS notifications (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES users(id) NOT NULL,
    type VARCHAR(50) NOT NULL CHECK (type IN ('medication', 'attendance', 'meal', 'alert', 'panic')),
    severity VARCHAR(20) NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    related_patient_id UUID REFERENCES patients(id),
    related_caregiver_id UUID REFERENCES users(id),
    sent_via JSONB, -- {push: true, email: true}
    read BOOLEAN DEFAULT false,
    acknowledged BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Configuración de alertas
CREATE TABLE IF NOT EXISTS alert_settings (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    patient_id UUID REFERENCES patients(id) NOT NULL,
    created_by UUID REFERENCES users(id) NOT NULL,
    -- Tiempos configurables
    late_arrival_minutes INTEGER DEFAULT 10, -- Minutos tarde para alertar
    no_activity_hours INTEGER DEFAULT 3, -- Horas sin actividad
    medication_reminder_minutes INTEGER DEFAULT 10,
    medication_alert_minutes INTEGER DEFAULT 15,
    medication_escalate_minutes INTEGER DEFAULT 30,
    -- Notificaciones
    notify_all_family BOOLEAN DEFAULT true, -- Notificar a todos los familiares
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Validación de fotos (anti-fraude)
CREATE TABLE IF NOT EXISTS photo_validations (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    photo_url TEXT NOT NULL,
    photo_hash VARCHAR(255) UNIQUE NOT NULL,
    timestamp_captured TIMESTAMP NOT NULL,
    timestamp_uploaded TIMESTAMP NOT NULL,
    time_diff_seconds INTEGER NOT NULL, -- Debe ser < 60
    gps_lat DECIMAL(10, 8),
    gps_lng DECIMAL(11, 8),
    device_id VARCHAR(255),
    watermark_data JSONB, -- Datos del watermark invisible
    exif_data JSONB,
    valid BOOLEAN DEFAULT false,
    validation_errors JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Registro de intentos de vulneración (auditoría)
CREATE TABLE IF NOT EXISTS security_audit_log (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    action VARCHAR(100) NOT NULL,
    details JSONB,
    ip_address INET,
    user_agent TEXT,
    blocked BOOLEAN DEFAULT false,
    reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Índices para mejorar rendimiento
CREATE INDEX idx_attendance_caregiver ON attendance(caregiver_id);
CREATE INDEX idx_attendance_patient ON attendance(patient_id);
CREATE INDEX idx_medication_logs_scheduled ON medication_logs(scheduled_time);
CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_notifications_unread ON notifications(user_id, read) WHERE read = false;
CREATE INDEX idx_meal_logs_date ON meal_logs(date, patient_id);

-- Row Level Security (RLS)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE medications ENABLE ROW LEVEL SECURITY;
ALTER TABLE medication_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE meal_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Comentarios explicativos
COMMENT ON TABLE users IS 'Usuarios del sistema: admin (familiar a cargo), observer (familiares), caregiver (cuidadoras)';
COMMENT ON TABLE attendance IS 'Control de asistencia con verificación GPS obligatoria';
COMMENT ON TABLE medication_logs IS 'Registro de medicamentos con foto obligatoria en tiempo real';
COMMENT ON TABLE exit_questionnaires IS 'Cuestionario obligatorio antes de marcar salida';
COMMENT ON TABLE photo_validations IS 'Sistema anti-fraude para validar fotos en tiempo real';
COMMENT ON TABLE security_audit_log IS 'Registro de intentos de vulneración del sistema';