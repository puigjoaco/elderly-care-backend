-- Crear tablas para el sistema de cuidados
CREATE TABLE IF NOT EXISTS patients (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    age INTEGER NOT NULL,
    condition TEXT,
    location TEXT,
    current_caregiver VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS caregivers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(20),
    shift VARCHAR(100),
    username VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS medications (
    id SERIAL PRIMARY KEY,
    patient_id INTEGER REFERENCES patients(id),
    name VARCHAR(255) NOT NULL,
    dose VARCHAR(100),
    schedule_time TIME,
    critical BOOLEAN DEFAULT false,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS medication_logs (
    id SERIAL PRIMARY KEY,
    medication_id INTEGER REFERENCES medications(id),
    caregiver_id INTEGER REFERENCES caregivers(id),
    administered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    photo_url TEXT,
    notes TEXT
);

CREATE TABLE IF NOT EXISTS alerts (
    id SERIAL PRIMARY KEY,
    patient_id INTEGER REFERENCES patients(id),
    type VARCHAR(50),
    severity VARCHAR(20),
    message TEXT,
    acknowledged BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS daily_reports (
    id SERIAL PRIMARY KEY,
    patient_id INTEGER REFERENCES patients(id),
    caregiver_id INTEGER REFERENCES caregivers(id),
    date DATE DEFAULT CURRENT_DATE,
    weight DECIMAL(5,2),
    weight_photo_url TEXT,
    meals_count INTEGER DEFAULT 0,
    medications_given INTEGER DEFAULT 0,
    final_state_photo_url TEXT,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insertar datos de ejemplo
INSERT INTO patients (name, age, condition, location, current_caregiver) 
VALUES 
    ('Mi Madre', 78, 'Supervisión de cuidados generales', 'En su casa', 'Siomara (Turno Día 9am-8pm)'),
    ('Mi Padre', 82, 'Movilidad reducida', 'En su casa', 'Carmen (Turno Noche 8pm-9am)');

INSERT INTO caregivers (name, phone, shift, username, password_hash)
VALUES 
    ('Siomara', '555-1234', 'Lun-Vie 9am-8pm', 'siomara_cuidadora', 'hashed_password_here'),
    ('Carmen', '555-5678', 'Lun-Vie 8pm-9am', 'carmen_cuidadora', 'hashed_password_here');

INSERT INTO medications (patient_id, name, dose, schedule_time, critical)
VALUES 
    (1, 'Escitalopram', '10mg (media pastilla)', '08:00', true),
    (1, 'Memantine', '20mg', '20:00', true),
    (1, 'Vitamina D', '1000 UI', '12:00', false);