// Servicio de Autenticación con Supabase
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

// Configuración de Supabase
const supabaseUrl = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

// Cliente admin con service key para operaciones privilegiadas
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

// Configuración de email (usar SendGrid en producción)
const emailTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: process.env.SMTP_PORT || 587,
    secure: false,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});

class AuthService {
    // ========================================
    // REGISTRO DE FAMILIAR ADMIN (Primer usuario)
    // ========================================
    async registerFamilyAdmin(data) {
        try {
            const {
                email,
                password,
                fullName,
                phone,
                relationship,
                patientData,
                enable2FA = false
            } = data;

            // 1. Crear usuario en Supabase Auth
            const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
                email,
                password,
                email_confirm: true,
                user_metadata: {
                    full_name: fullName,
                    role: 'admin'
                }
            });

            if (authError) throw authError;

            // 2. Crear perfil extendido
            const { data: profile, error: profileError } = await supabaseAdmin
                .from('user_profiles')
                .update({
                    phone,
                    full_name: fullName,
                    role: 'admin',
                    relationship,
                    is_primary_contact: true,
                    two_factor_enabled: enable2FA
                })
                .eq('id', authUser.user.id)
                .select()
                .single();

            if (profileError) throw profileError;

            // 3. Crear paciente asociado
            const { data: patient, error: patientError } = await supabaseAdmin
                .from('patients_auth')
                .insert({
                    owner_id: authUser.user.id,
                    name: patientData.name,
                    age: patientData.age,
                    condition: patientData.condition,
                    address: patientData.address,
                    lat: patientData.lat,
                    lng: patientData.lng,
                    radius_meters: patientData.radiusMeters || 30,
                    medical_history: patientData.medicalHistory || {},
                    emergency_contacts: patientData.emergencyContacts || []
                })
                .select()
                .single();

            if (patientError) throw patientError;

            // 4. Crear acceso automático al paciente
            await supabaseAdmin
                .from('patient_access')
                .insert({
                    patient_id: patient.id,
                    user_id: authUser.user.id,
                    access_level: 'owner',
                    granted_by: authUser.user.id
                });

            // 5. Enviar email de bienvenida
            await this.sendWelcomeEmail(email, fullName);

            return {
                success: true,
                user: authUser.user,
                profile,
                patient,
                message: 'Registro exitoso. Cuenta de administrador creada.'
            };

        } catch (error) {
            console.error('Error en registro de admin:', error);
            throw error;
        }
    }

    // ========================================
    // CREAR CUIDADORA (Solo admin puede hacer esto)
    // ========================================
    async createCaregiver(adminId, caregiverData) {
        try {
            const {
                email,
                fullName,
                phone,
                employeeId,
                shiftSchedule,
                patientId
            } = caregiverData;

            // Verificar que el admin es dueño del paciente
            const { data: patient, error: patientError } = await supabaseAdmin
                .from('patients_auth')
                .select('*')
                .eq('id', patientId)
                .eq('owner_id', adminId)
                .single();

            if (patientError || !patient) {
                throw new Error('No autorizado para crear cuidadora para este paciente');
            }

            // Generar contraseña temporal
            const tempPassword = this.generateTempPassword();

            // 1. Crear usuario cuidadora
            const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
                email,
                password: tempPassword,
                email_confirm: true,
                user_metadata: {
                    full_name: fullName,
                    role: 'caregiver'
                }
            });

            if (authError) throw authError;

            // 2. Actualizar perfil con datos de cuidadora
            await supabaseAdmin
                .from('user_profiles')
                .update({
                    phone,
                    full_name: fullName,
                    role: 'caregiver',
                    employee_id: employeeId,
                    shift_schedule: shiftSchedule,
                    created_by: adminId
                })
                .eq('id', authUser.user.id);

            // 3. Dar acceso al paciente
            await supabaseAdmin
                .from('patient_access')
                .insert({
                    patient_id: patientId,
                    user_id: authUser.user.id,
                    access_level: 'caregiver',
                    granted_by: adminId
                });

            // 4. Enviar credenciales por email
            await this.sendCaregiverCredentials(email, fullName, tempPassword, patient.name);

            // 5. También enviar SMS si está configurado
            if (phone) {
                // await this.sendSMS(phone, `Hola ${fullName}, tus credenciales de acceso han sido enviadas a ${email}`);
            }

            return {
                success: true,
                caregiverId: authUser.user.id,
                message: `Cuidadora ${fullName} creada. Credenciales enviadas a ${email}`
            };

        } catch (error) {
            console.error('Error creando cuidadora:', error);
            throw error;
        }
    }

    // ========================================
    // INVITAR FAMILIAR OBSERVADOR
    // ========================================
    async inviteObserver(adminId, observerData) {
        try {
            const {
                email,
                fullName,
                relationship,
                patientId,
                phone
            } = observerData;

            // Verificar que el admin es dueño del paciente
            const { data: patient } = await supabaseAdmin
                .from('patients_auth')
                .select('*')
                .eq('id', patientId)
                .eq('owner_id', adminId)
                .single();

            if (!patient) {
                throw new Error('No autorizado para invitar observadores para este paciente');
            }

            // Generar token de invitación
            const invitationToken = crypto.randomBytes(32).toString('hex');
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + 7); // Expira en 7 días

            // Crear invitación
            const { data: invitation } = await supabaseAdmin
                .from('invitations')
                .insert({
                    email,
                    role: 'observer',
                    patient_id: patientId,
                    invited_by: adminId,
                    invitation_token: invitationToken,
                    expires_at: expiresAt.toISOString()
                })
                .select()
                .single();

            // Enviar email de invitación
            const inviteLink = `${process.env.APP_URL}/accept-invite?token=${invitationToken}`;
            await this.sendInvitationEmail(email, fullName, patient.name, inviteLink, relationship);

            return {
                success: true,
                invitationId: invitation.id,
                message: `Invitación enviada a ${email}`
            };

        } catch (error) {
            console.error('Error invitando observador:', error);
            throw error;
        }
    }

    // ========================================
    // ACEPTAR INVITACIÓN
    // ========================================
    async acceptInvitation(token, password) {
        try {
            // Buscar invitación válida
            const { data: invitation, error } = await supabaseAdmin
                .from('invitations')
                .select('*')
                .eq('invitation_token', token)
                .eq('accepted', false)
                .gt('expires_at', new Date().toISOString())
                .single();

            if (error || !invitation) {
                throw new Error('Invitación inválida o expirada');
            }

            // Crear usuario
            const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
                email: invitation.email,
                password,
                email_confirm: true,
                user_metadata: {
                    role: invitation.role
                }
            });

            if (authError) throw authError;

            // Dar acceso al paciente
            await supabaseAdmin
                .from('patient_access')
                .insert({
                    patient_id: invitation.patient_id,
                    user_id: authUser.user.id,
                    access_level: invitation.role,
                    granted_by: invitation.invited_by
                });

            // Marcar invitación como aceptada
            await supabaseAdmin
                .from('invitations')
                .update({
                    accepted: true,
                    accepted_at: new Date().toISOString()
                })
                .eq('id', invitation.id);

            return {
                success: true,
                message: 'Invitación aceptada. Puedes iniciar sesión.'
            };

        } catch (error) {
            console.error('Error aceptando invitación:', error);
            throw error;
        }
    }

    // ========================================
    // LOGIN CON 2FA OPCIONAL
    // ========================================
    async login(email, password, req) {
        try {
            // Intentar login
            const { data: authData, error: authError } = await supabaseAdmin.auth.signInWithPassword({
                email,
                password
            });

            if (authError) {
                // Registrar intento fallido
                await this.logFailedLogin(email, req.ip, req.headers['user-agent']);
                throw authError;
            }

            // Obtener perfil del usuario
            const { data: profile } = await supabaseAdmin
                .from('user_profiles')
                .select('*')
                .eq('id', authData.user.id)
                .single();

            // Si tiene 2FA habilitado
            if (profile?.two_factor_enabled) {
                // Generar y enviar código 2FA
                const code = this.generate2FACode();
                const expiresAt = new Date();
                expiresAt.setMinutes(expiresAt.getMinutes() + 10); // Expira en 10 minutos

                await supabaseAdmin
                    .from('two_factor_codes')
                    .insert({
                        user_id: authData.user.id,
                        code,
                        expires_at: expiresAt.toISOString()
                    });

                // Enviar código por email
                await this.send2FACode(email, code);

                return {
                    success: true,
                    requiresTwoFactor: true,
                    userId: authData.user.id,
                    message: 'Código 2FA enviado a tu email'
                };
            }

            // Login exitoso sin 2FA
            await this.createSession(authData.user.id, req);

            return {
                success: true,
                user: authData.user,
                session: authData.session,
                profile,
                message: 'Login exitoso'
            };

        } catch (error) {
            console.error('Error en login:', error);
            throw error;
        }
    }

    // ========================================
    // VERIFICAR CÓDIGO 2FA
    // ========================================
    async verify2FA(userId, code) {
        try {
            const { data: valid } = await supabaseAdmin
                .rpc('verify_2fa_code', {
                    p_user_id: userId,
                    p_code: code
                });

            if (!valid) {
                throw new Error('Código 2FA inválido o expirado');
            }

            // Obtener sesión del usuario
            const { data: authData } = await supabaseAdmin.auth.admin.getUserById(userId);

            return {
                success: true,
                user: authData.user,
                message: 'Autenticación 2FA exitosa'
            };

        } catch (error) {
            console.error('Error verificando 2FA:', error);
            throw error;
        }
    }

    // ========================================
    // FUNCIONES AUXILIARES
    // ========================================
    
    generateTempPassword() {
        return crypto.randomBytes(8).toString('hex');
    }

    generate2FACode() {
        return Math.floor(100000 + Math.random() * 900000).toString();
    }

    async createSession(userId, req) {
        await supabaseAdmin
            .from('auth_sessions')
            .insert({
                user_id: userId,
                ip_address: req.ip,
                user_agent: req.headers['user-agent'],
                device_info: {
                    platform: req.headers['sec-ch-ua-platform'],
                    mobile: req.headers['sec-ch-ua-mobile']
                }
            });
    }

    async logFailedLogin(email, ip, userAgent) {
        await supabaseAdmin
            .from('failed_login_attempts')
            .insert({
                email,
                ip_address: ip,
                user_agent: userAgent,
                error_type: 'invalid_password'
            });
    }

    // ========================================
    // ENVÍO DE EMAILS
    // ========================================
    
    async sendWelcomeEmail(email, name) {
        const mailOptions = {
            from: '"Sistema de Cuidados" <noreply@cuidados.com>',
            to: email,
            subject: '¡Bienvenido al Sistema de Supervisión de Cuidados!',
            html: `
                <h2>Hola ${name}!</h2>
                <p>Tu cuenta de administrador ha sido creada exitosamente.</p>
                <p>Ya puedes:</p>
                <ul>
                    <li>Crear cuentas para cuidadoras</li>
                    <li>Invitar familiares observadores</li>
                    <li>Configurar horarios de medicamentos</li>
                    <li>Ver todo en tiempo real</li>
                </ul>
                <p>Inicia sesión en: ${process.env.APP_URL}</p>
            `
        };

        await emailTransporter.sendMail(mailOptions);
    }

    async sendCaregiverCredentials(email, name, password, patientName) {
        const mailOptions = {
            from: '"Sistema de Cuidados" <noreply@cuidados.com>',
            to: email,
            subject: 'Tus credenciales de acceso - Sistema de Cuidados',
            html: `
                <h2>Hola ${name}!</h2>
                <p>Has sido registrada como cuidadora de <strong>${patientName}</strong>.</p>
                <p>Tus credenciales de acceso son:</p>
                <div style="background: #f3f4f6; padding: 20px; border-radius: 10px; margin: 20px 0;">
                    <p><strong>Email:</strong> ${email}</p>
                    <p><strong>Contraseña temporal:</strong> ${password}</p>
                </div>
                <p><strong>IMPORTANTE:</strong> Cambia tu contraseña en el primer inicio de sesión.</p>
                <p>Descarga la app en: ${process.env.APP_URL}/download</p>
            `
        };

        await emailTransporter.sendMail(mailOptions);
    }

    async sendInvitationEmail(email, name, patientName, inviteLink, relationship) {
        const mailOptions = {
            from: '"Sistema de Cuidados" <noreply@cuidados.com>',
            to: email,
            subject: `Invitación - Supervisión de cuidados de ${patientName}`,
            html: `
                <h2>Hola ${name}!</h2>
                <p>Has sido invitado como <strong>${relationship}</strong> para supervisar los cuidados de <strong>${patientName}</strong>.</p>
                <p>Con esta cuenta podrás:</p>
                <ul>
                    <li>Ver todas las actividades en tiempo real</li>
                    <li>Recibir alertas importantes</li>
                    <li>Ver fotos y reportes</li>
                    <li>Acceder al historial médico</li>
                </ul>
                <div style="text-align: center; margin: 30px 0;">
                    <a href="${inviteLink}" style="background: #667eea; color: white; padding: 15px 30px; text-decoration: none; border-radius: 10px; display: inline-block;">
                        Aceptar Invitación
                    </a>
                </div>
                <p><small>Este enlace expira en 7 días.</small></p>
            `
        };

        await emailTransporter.sendMail(mailOptions);
    }

    async send2FACode(email, code) {
        const mailOptions = {
            from: '"Sistema de Cuidados" <noreply@cuidados.com>',
            to: email,
            subject: 'Código de verificación - Sistema de Cuidados',
            html: `
                <h2>Tu código de verificación</h2>
                <div style="background: #667eea; color: white; padding: 20px; border-radius: 10px; text-align: center; font-size: 32px; letter-spacing: 5px; margin: 20px 0;">
                    ${code}
                </div>
                <p>Este código expira en 10 minutos.</p>
                <p><small>Si no solicitaste este código, ignora este email.</small></p>
            `
        };

        await emailTransporter.sendMail(mailOptions);
    }
}

module.exports = new AuthService();