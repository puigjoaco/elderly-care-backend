-- Configuración de Autenticación y Roles en Supabase
-- Este archivo configura el sistema completo de usuarios y permisos

-- Habilitar extensiones necesarias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Crear enum para roles
DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('admin', 'caregiver', 'observer');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Extender la tabla auth.users con información adicional
CREATE TABLE IF NOT EXISTS public.user_profiles (
    id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(20),
    full_name VARCHAR(255) NOT NULL,
    role user_role NOT NULL,
    created_by UUID REFERENCES auth.users(id),
    is_active BOOLEAN DEFAULT true,
    two_factor_enabled BOOLEAN DEFAULT false,
    
    -- Para cuidadoras
    employee_id VARCHAR(50),
    shift_schedule JSONB, -- {"monday": {"start": "09:00", "end": "20:00"}, ...}
    
    -- Para familiares
    relationship VARCHAR(50), -- "hijo", "hija", "nieto", etc.
    is_primary_contact BOOLEAN DEFAULT false,
    
    -- Metadata
    last_login TIMESTAMP,
    login_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Tabla de pacientes mejorada con owner
CREATE TABLE IF NOT EXISTS public.patients_auth (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    owner_id UUID REFERENCES auth.users(id) NOT NULL, -- El familiar admin
    name VARCHAR(255) NOT NULL,
    age INTEGER NOT NULL,
    condition TEXT,
    address TEXT NOT NULL,
    lat DECIMAL(10, 8) NOT NULL,
    lng DECIMAL(11, 8) NOT NULL,
    radius_meters INTEGER DEFAULT 30,
    photo_url TEXT,
    medical_history JSONB,
    emergency_contacts JSONB,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Tabla de permisos de acceso a pacientes
CREATE TABLE IF NOT EXISTS public.patient_access (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    patient_id UUID REFERENCES patients_auth(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    access_level VARCHAR(50) NOT NULL, -- 'owner', 'caregiver', 'observer'
    granted_by UUID REFERENCES auth.users(id),
    granted_at TIMESTAMP DEFAULT NOW(),
    expires_at TIMESTAMP, -- Para accesos temporales
    UNIQUE(patient_id, user_id)
);

-- Tabla de invitaciones pendientes
CREATE TABLE IF NOT EXISTS public.invitations (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    role user_role NOT NULL,
    patient_id UUID REFERENCES patients_auth(id),
    invited_by UUID REFERENCES auth.users(id) NOT NULL,
    invitation_token VARCHAR(255) UNIQUE NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    accepted BOOLEAN DEFAULT false,
    accepted_at TIMESTAMP,
    
    -- Para cuidadoras
    shift_schedule JSONB,
    employee_id VARCHAR(50),
    
    created_at TIMESTAMP DEFAULT NOW()
);

-- Tabla de sesiones y auditoría
CREATE TABLE IF NOT EXISTS public.auth_sessions (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    ip_address INET,
    user_agent TEXT,
    device_info JSONB,
    login_at TIMESTAMP DEFAULT NOW(),
    logout_at TIMESTAMP,
    is_active BOOLEAN DEFAULT true,
    location_lat DECIMAL(10, 8),
    location_lng DECIMAL(11, 8)
);

-- Tabla de intentos de login fallidos (seguridad)
CREATE TABLE IF NOT EXISTS public.failed_login_attempts (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    email VARCHAR(255),
    ip_address INET,
    user_agent TEXT,
    attempted_at TIMESTAMP DEFAULT NOW(),
    error_type VARCHAR(50) -- 'invalid_password', 'user_not_found', 'account_locked'
);

-- Tabla de códigos 2FA
CREATE TABLE IF NOT EXISTS public.two_factor_codes (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    code VARCHAR(6) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    used BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Función para crear perfil automáticamente cuando se registra un usuario
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.user_profiles (id, email, full_name, role)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
        COALESCE((NEW.raw_user_meta_data->>'role')::user_role, 'observer')
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger para crear perfil automáticamente
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Row Level Security (RLS)
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE patients_auth ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_sessions ENABLE ROW LEVEL SECURITY;

-- Políticas de seguridad para user_profiles
CREATE POLICY "Users can view their own profile"
    ON user_profiles FOR SELECT
    USING (auth.uid() = id);

CREATE POLICY "Admins can view all profiles in their organization"
    ON user_profiles FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM user_profiles up
            WHERE up.id = auth.uid() 
            AND up.role = 'admin'
        )
    );

CREATE POLICY "Users can update their own profile"
    ON user_profiles FOR UPDATE
    USING (auth.uid() = id);

-- Políticas para patients_auth
CREATE POLICY "Owners can manage their patients"
    ON patients_auth FOR ALL
    USING (owner_id = auth.uid());

CREATE POLICY "Authorized users can view patients"
    ON patients_auth FOR SELECT
    USING (
        owner_id = auth.uid() OR
        EXISTS (
            SELECT 1 FROM patient_access pa
            WHERE pa.patient_id = patients_auth.id
            AND pa.user_id = auth.uid()
            AND (pa.expires_at IS NULL OR pa.expires_at > NOW())
        )
    );

-- Políticas para patient_access
CREATE POLICY "Admins can manage patient access"
    ON patient_access FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM patients_auth p
            WHERE p.id = patient_access.patient_id
            AND p.owner_id = auth.uid()
        )
    );

CREATE POLICY "Users can view their own access"
    ON patient_access FOR SELECT
    USING (user_id = auth.uid());

-- Función para validar 2FA
CREATE OR REPLACE FUNCTION public.verify_2fa_code(
    p_user_id UUID,
    p_code VARCHAR(6)
)
RETURNS BOOLEAN AS $$
DECLARE
    v_valid BOOLEAN;
BEGIN
    UPDATE two_factor_codes
    SET used = true
    WHERE user_id = p_user_id
        AND code = p_code
        AND expires_at > NOW()
        AND used = false
    RETURNING true INTO v_valid;
    
    RETURN COALESCE(v_valid, false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Función para registrar intento de login
CREATE OR REPLACE FUNCTION public.log_login_attempt(
    p_email VARCHAR(255),
    p_success BOOLEAN,
    p_ip_address INET DEFAULT NULL,
    p_user_agent TEXT DEFAULT NULL
)
RETURNS void AS $$
BEGIN
    IF NOT p_success THEN
        INSERT INTO failed_login_attempts (email, ip_address, user_agent)
        VALUES (p_email, p_ip_address, p_user_agent);
        
        -- Bloquear cuenta después de 5 intentos fallidos en 15 minutos
        IF (
            SELECT COUNT(*) 
            FROM failed_login_attempts 
            WHERE email = p_email 
            AND attempted_at > NOW() - INTERVAL '15 minutes'
        ) >= 5 THEN
            -- Aquí se podría implementar bloqueo de cuenta
            RAISE EXCEPTION 'Account temporarily locked due to multiple failed login attempts';
        END IF;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Función para crear invitación
CREATE OR REPLACE FUNCTION public.create_invitation(
    p_email VARCHAR(255),
    p_role user_role,
    p_patient_id UUID,
    p_invited_by UUID,
    p_shift_schedule JSONB DEFAULT NULL,
    p_employee_id VARCHAR(50) DEFAULT NULL
)
RETURNS TABLE(invitation_token VARCHAR, expires_at TIMESTAMP) AS $$
DECLARE
    v_token VARCHAR(255);
    v_expires TIMESTAMP;
BEGIN
    -- Generar token único
    v_token := encode(gen_random_bytes(32), 'hex');
    v_expires := NOW() + INTERVAL '7 days';
    
    INSERT INTO invitations (
        email, role, patient_id, invited_by, 
        invitation_token, expires_at,
        shift_schedule, employee_id
    )
    VALUES (
        p_email, p_role, p_patient_id, p_invited_by,
        v_token, v_expires,
        p_shift_schedule, p_employee_id
    );
    
    RETURN QUERY SELECT v_token, v_expires;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Índices para mejorar performance
CREATE INDEX idx_user_profiles_role ON user_profiles(role);
CREATE INDEX idx_user_profiles_active ON user_profiles(is_active);
CREATE INDEX idx_patient_access_user ON patient_access(user_id);
CREATE INDEX idx_patient_access_patient ON patient_access(patient_id);
CREATE INDEX idx_invitations_token ON invitations(invitation_token);
CREATE INDEX idx_invitations_email ON invitations(email);
CREATE INDEX idx_auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX idx_auth_sessions_active ON auth_sessions(is_active);
CREATE INDEX idx_failed_login_email ON failed_login_attempts(email);
CREATE INDEX idx_failed_login_time ON failed_login_attempts(attempted_at);

-- Comentarios
COMMENT ON TABLE user_profiles IS 'Perfiles extendidos de usuarios con roles y permisos';
COMMENT ON TABLE patients_auth IS 'Pacientes con owner y control de acceso';
COMMENT ON TABLE patient_access IS 'Control de acceso granular a pacientes';
COMMENT ON TABLE invitations IS 'Sistema de invitaciones para nuevos usuarios';
COMMENT ON TABLE auth_sessions IS 'Auditoría de sesiones de usuario';
COMMENT ON TABLE two_factor_codes IS 'Códigos 2FA para autenticación adicional';