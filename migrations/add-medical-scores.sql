-- Agregar columnas de scores médicos validados al cuestionario de salida

ALTER TABLE exit_questionnaires 
ADD COLUMN IF NOT EXISTS barthel_score INTEGER,
ADD COLUMN IF NOT EXISTS norton_score INTEGER,
ADD COLUMN IF NOT EXISTS mna_score INTEGER,
ADD COLUMN IF NOT EXISTS cam_score INTEGER,
ADD COLUMN IF NOT EXISTS global_risk_score INTEGER,
ADD COLUMN IF NOT EXISTS answers_json JSONB,
ADD COLUMN IF NOT EXISTS time_taken_seconds INTEGER;

-- Índices para búsquedas rápidas por scores de riesgo
CREATE INDEX IF NOT EXISTS idx_questionnaire_risk ON exit_questionnaires(global_risk_score) WHERE global_risk_score > 4;
CREATE INDEX IF NOT EXISTS idx_questionnaire_barthel ON exit_questionnaires(barthel_score) WHERE barthel_score < 60;
CREATE INDEX IF NOT EXISTS idx_questionnaire_norton ON exit_questionnaires(norton_score) WHERE norton_score < 14;
CREATE INDEX IF NOT EXISTS idx_questionnaire_confusion ON exit_questionnaires(cam_score) WHERE cam_score > 0;

-- Tabla para almacenar plantillas de cuestionario personalizadas
CREATE TABLE IF NOT EXISTS questionnaire_templates (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    patient_id UUID REFERENCES patients(id),
    template_name VARCHAR(100),
    custom_questions JSONB,
    created_by UUID REFERENCES users(id),
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabla para análisis de tendencias
CREATE TABLE IF NOT EXISTS patient_trends (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    patient_id UUID REFERENCES patients(id) NOT NULL,
    date DATE NOT NULL,
    weight_trend VARCHAR(20), -- up, down, stable
    barthel_trend VARCHAR(20), -- improving, declining, stable
    norton_trend VARCHAR(20),
    confusion_days INTEGER, -- días con confusión en la semana
    risk_level VARCHAR(20), -- low, medium, high, critical
    alerts_generated INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(patient_id, date)
);

-- Vista materializada para dashboard de riesgos
CREATE MATERIALIZED VIEW IF NOT EXISTS patient_risk_dashboard AS
SELECT 
    p.id as patient_id,
    p.name as patient_name,
    p.age,
    p.condition,
    eq.barthel_score as last_barthel,
    eq.norton_score as last_norton,
    eq.mna_score as last_mna,
    eq.cam_score as last_cam,
    eq.global_risk_score as last_risk,
    eq.patient_weight as last_weight,
    eq.completed_at as last_evaluation,
    CASE 
        WHEN eq.global_risk_score >= 6 THEN 'critical'
        WHEN eq.global_risk_score >= 4 THEN 'high'
        WHEN eq.global_risk_score >= 2 THEN 'medium'
        ELSE 'low'
    END as risk_category,
    CASE
        WHEN eq.barthel_score < 40 THEN 'Dependencia total'
        WHEN eq.barthel_score < 60 THEN 'Dependencia severa'
        WHEN eq.barthel_score < 80 THEN 'Dependencia moderada'
        WHEN eq.barthel_score < 100 THEN 'Dependencia leve'
        ELSE 'Independiente'
    END as functional_status,
    CASE
        WHEN eq.norton_score < 10 THEN 'Muy alto riesgo úlceras'
        WHEN eq.norton_score < 14 THEN 'Alto riesgo úlceras'
        WHEN eq.norton_score < 18 THEN 'Riesgo medio úlceras'
        ELSE 'Bajo riesgo úlceras'
    END as pressure_ulcer_risk,
    CASE
        WHEN eq.mna_score < 8 THEN 'Malnutrición'
        WHEN eq.mna_score < 12 THEN 'Riesgo malnutrición'
        ELSE 'Estado nutricional normal'
    END as nutritional_status
FROM patients p
LEFT JOIN LATERAL (
    SELECT *
    FROM exit_questionnaires
    WHERE patient_id = p.id
    ORDER BY completed_at DESC
    LIMIT 1
) eq ON true;

-- Función para calcular alertas automáticas
CREATE OR REPLACE FUNCTION calculate_questionnaire_alerts()
RETURNS TRIGGER AS $$
BEGIN
    -- Si el riesgo global es alto, crear alerta automática
    IF NEW.global_risk_score >= 6 THEN
        INSERT INTO notifications (
            user_id,
            type,
            severity,
            title,
            message,
            related_patient_id,
            sent_via
        )
        SELECT 
            u.id,
            'alert',
            'critical',
            '🔴 Paciente en riesgo alto',
            'Score de riesgo: ' || NEW.global_risk_score || '/10. Revisar inmediatamente.',
            NEW.patient_id,
            '{"push": true, "email": true}'::jsonb
        FROM users u
        WHERE u.role IN ('admin', 'observer');
    END IF;

    -- Si hay confusión severa
    IF NEW.cam_score = 2 THEN
        INSERT INTO notifications (
            user_id,
            type,
            severity,
            title,
            message,
            related_patient_id,
            sent_via
        )
        SELECT 
            u.id,
            'alert',
            'critical',
            '🧠 Confusión severa detectada',
            'El paciente presentó confusión la mayor parte del día.',
            NEW.patient_id,
            '{"push": true, "email": true}'::jsonb
        FROM users u
        WHERE u.role IN ('admin', 'observer');
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Crear trigger para alertas automáticas
DROP TRIGGER IF EXISTS questionnaire_alerts_trigger ON exit_questionnaires;
CREATE TRIGGER questionnaire_alerts_trigger
    AFTER INSERT ON exit_questionnaires
    FOR EACH ROW
    EXECUTE FUNCTION calculate_questionnaire_alerts();

-- Comentarios explicativos
COMMENT ON COLUMN exit_questionnaires.barthel_score IS 'Índice de Barthel (0-100): Mide independencia funcional en actividades de la vida diaria';
COMMENT ON COLUMN exit_questionnaires.norton_score IS 'Escala Norton (5-20): Evalúa riesgo de úlceras por presión';
COMMENT ON COLUMN exit_questionnaires.mna_score IS 'Mini Nutritional Assessment (0-14): Evalúa estado nutricional';
COMMENT ON COLUMN exit_questionnaires.cam_score IS 'Confusion Assessment Method (0-2): Detecta presencia y severidad de delirium';
COMMENT ON COLUMN exit_questionnaires.global_risk_score IS 'Score de riesgo global (0-10): Combina múltiples indicadores de riesgo';