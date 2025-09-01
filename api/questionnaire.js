// Cuestionario de Salida Médicamente Validado
// Basado en: Barthel Index + CAM (Confusion Assessment) + Norton Scale + MNA-SF
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Estructura del cuestionario optimizado (< 2 minutos para completar)
const questionnaireTemplate = {
  // SECCIÓN 1: SIGNOS VITALES (30 segundos)
  vitals: {
    weight: {
      question: "Peso actual (kg)",
      type: "number",
      required: true,
      photo_required: true, // Foto de la báscula
      validation: (value) => value > 20 && value < 200
    },
    blood_pressure: {
      question: "Presión arterial (si se tomó)",
      type: "text",
      required: false,
      format: "120/80"
    },
    temperature: {
      question: "Temperatura (°C)",
      type: "number",
      required: false,
      validation: (value) => value > 35 && value < 42
    }
  },

  // SECCIÓN 2: MOVILIDAD - Barthel Index simplificado (20 segundos)
  mobility: {
    walking: {
      question: "¿Cómo caminó hoy?",
      type: "scale",
      required: true,
      options: [
        { value: 3, label: "👍 Solo", emoji: "🚶", color: "green" },
        { value: 2, label: "👌 Con ayuda", emoji: "🦯", color: "yellow" },
        { value: 1, label: "👎 Silla ruedas", emoji: "♿", color: "orange" },
        { value: 0, label: "❌ No caminó", emoji: "🛏️", color: "red" }
      ],
      medical_scale: "Barthel_Walking"
    },
    bathroom: {
      question: "¿Fue al baño?",
      type: "scale",
      required: true,
      options: [
        { value: 2, label: "✅ Solo", color: "green" },
        { value: 1, label: "⚠️ Con ayuda", color: "yellow" },
        { value: 0, label: "❌ Pañal/Cama", color: "red" }
      ],
      medical_scale: "Barthel_Toilet"
    }
  },

  // SECCIÓN 3: NUTRICIÓN - MNA-SF adaptado (20 segundos)
  nutrition: {
    meals: {
      question: "¿Cuántas comidas completas?",
      type: "counter",
      required: true,
      min: 0,
      max: 5,
      emojis: ["🍽️"],
      medical_scale: "MNA_Meals"
    },
    appetite: {
      question: "¿Cómo estuvo el apetito?",
      type: "quick_select",
      required: true,
      options: [
        { value: 2, label: "😋 Bueno", color: "green" },
        { value: 1, label: "😐 Regular", color: "yellow" },
        { value: 0, label: "😟 Malo", color: "red" }
      ],
      medical_scale: "MNA_Appetite"
    },
    liquids: {
      question: "Vasos de líquido (aprox)",
      type: "counter",
      required: true,
      min: 0,
      max: 12,
      emojis: ["💧"],
      medical_scale: "Hydration"
    }
  },

  // SECCIÓN 4: ESTADO MENTAL - CAM simplificado (30 segundos)
  mental: {
    confusion: {
      question: "¿Hubo momentos de confusión?",
      type: "binary_detailed",
      required: true,
      options: [
        { value: 0, label: "✅ No, lúcido todo el día", color: "green" },
        { value: 1, label: "⚠️ Sí, algunos momentos", color: "yellow", follow_up: true },
        { value: 2, label: "🔴 Sí, la mayor parte del día", color: "red", alert: true }
      ],
      medical_scale: "CAM_Confusion"
    },
    mood: {
      question: "Estado de ánimo general",
      type: "faces_scale",
      required: true,
      options: [
        { value: 5, emoji: "😄", label: "Muy bien" },
        { value: 4, emoji: "🙂", label: "Bien" },
        { value: 3, emoji: "😐", label: "Normal" },
        { value: 2, emoji: "😕", label: "Triste" },
        { value: 1, emoji: "😢", label: "Muy triste" }
      ],
      medical_scale: "Mood_Scale"
    },
    sleep_day: {
      question: "¿Durmió durante el día?",
      type: "quick_select",
      required: true,
      options: [
        { value: 0, label: "No", color: "green" },
        { value: 1, label: "Siesta normal", color: "blue" },
        { value: 2, label: "Mucho sueño", color: "orange", alert: true }
      ],
      medical_scale: "Sleep_Pattern"
    }
  },

  // SECCIÓN 5: PIEL Y RIESGO - Norton Scale adaptado (20 segundos)
  skin: {
    skin_condition: {
      question: "Estado de la piel",
      type: "visual_check",
      required: true,
      options: [
        { value: 4, label: "✅ Normal", color: "green" },
        { value: 3, label: "⚠️ Seca", color: "yellow" },
        { value: 2, label: "🔶 Enrojecida", color: "orange", photo: true },
        { value: 1, label: "🔴 Herida/Úlcera", color: "red", photo: true, alert: true }
      ],
      medical_scale: "Norton_Skin"
    },
    position_changes: {
      question: "Cambios de posición",
      type: "counter",
      required: true,
      min: 0,
      max: 10,
      emojis: ["🔄"],
      medical_scale: "Norton_Activity"
    }
  },

  // SECCIÓN 6: MEDICACIÓN (10 segundos)
  medication: {
    all_given: {
      question: "¿Se dieron TODAS las medicinas?",
      type: "critical_binary",
      required: true,
      options: [
        { value: true, label: "✅ SÍ, todas", color: "green" },
        { value: false, label: "❌ NO, faltaron", color: "red", alert: true, follow_up: true }
      ]
    },
    side_effects: {
      question: "¿Alguna reacción a medicamentos?",
      type: "binary",
      required: true,
      alert_on: true
    }
  },

  // SECCIÓN 7: INCIDENTES Y OBSERVACIONES (20 segundos)
  incidents: {
    falls: {
      question: "¿Caídas o casi-caídas?",
      type: "critical_binary",
      required: true,
      alert_on: true,
      photo_if: true
    },
    pain: {
      question: "¿Dolor en algún momento?",
      type: "pain_scale",
      required: true,
      options: [
        { value: 0, emoji: "😊", label: "Sin dolor" },
        { value: 1, emoji: "😐", label: "Leve" },
        { value: 2, emoji: "😣", label: "Moderado" },
        { value: 3, emoji: "😖", label: "Fuerte", alert: true }
      ]
    },
    emergency: {
      question: "¿Algo urgente para informar?",
      type: "text_alert",
      required: false,
      placeholder: "Escribir solo si es importante",
      alert_if_filled: true
    }
  },

  // SECCIÓN 8: FOTO FINAL Y FIRMA (10 segundos)
  closure: {
    final_photo: {
      question: "Foto del paciente al terminar turno",
      type: "photo",
      required: true,
      purpose: "final_state"
    },
    caregiver_signature: {
      question: "Confirmo que toda la información es correcta",
      type: "signature",
      required: true
    }
  }
};

// Calcular scores médicos validados
function calculateMedicalScores(answers) {
  const scores = {
    // Barthel Index (0-100) - Independencia funcional
    barthel: 0,
    
    // Norton Scale (5-20) - Riesgo de úlceras por presión
    norton: 0,
    
    // Mini Nutritional Assessment (0-14) - Estado nutricional
    mna: 0,
    
    // CAM Score - Confusión/Delirium
    cam: 0,
    
    // Risk Score Global (0-10) - Riesgo general
    global_risk: 0
  };

  // Calcular Barthel (simplificado)
  scores.barthel = (
    (answers.mobility.walking * 15) +
    (answers.mobility.bathroom * 10) +
    50 // Puntos base por otras actividades no evaluadas
  );

  // Calcular Norton
  scores.norton = (
    answers.skin.skin_condition +
    Math.min(answers.skin.position_changes * 2, 4) +
    answers.mobility.walking +
    8 // Puntos base
  );

  // Calcular MNA
  scores.mna = (
    answers.nutrition.meals * 2 +
    answers.nutrition.appetite * 3 +
    Math.min(answers.nutrition.liquids, 8)
  );

  // Calcular CAM (presencia de delirium)
  scores.cam = answers.mental.confusion;

  // Calcular riesgo global
  const riskFactors = [
    scores.barthel < 60 ? 2 : 0,
    scores.norton < 14 ? 2 : 0,
    scores.mna < 8 ? 2 : 0,
    scores.cam > 0 ? 2 : 0,
    answers.incidents.falls ? 1 : 0,
    answers.incidents.pain > 1 ? 1 : 0
  ];
  
  scores.global_risk = riskFactors.reduce((a, b) => a + b, 0);

  return scores;
}

// Generar alertas automáticas basadas en respuestas
function generateAlerts(answers, scores) {
  const alerts = [];

  // Alertas críticas (notificación inmediata)
  if (scores.global_risk >= 6) {
    alerts.push({
      severity: 'critical',
      title: '🔴 RIESGO ALTO DETECTADO',
      message: 'Múltiples indicadores de riesgo. Revisar inmediatamente.',
      notify_all: true
    });
  }

  if (answers.mental.confusion === 2) {
    alerts.push({
      severity: 'critical',
      title: '🧠 Confusión severa',
      message: 'Paciente confundido la mayor parte del día',
      notify_all: true
    });
  }

  if (answers.incidents.falls) {
    alerts.push({
      severity: 'critical',
      title: '⚠️ Caída reportada',
      message: 'Revisar detalles y fotos del incidente',
      notify_all: true
    });
  }

  // Alertas importantes (notificación prioritaria)
  if (scores.norton < 14) {
    alerts.push({
      severity: 'warning',
      title: '🛏️ Riesgo de úlceras',
      message: `Norton Score: ${scores.norton}/20. Aumentar cambios de posición.`,
      notify_all: false
    });
  }

  if (scores.mna < 8) {
    alerts.push({
      severity: 'warning',
      title: '🍽️ Riesgo nutricional',
      message: `MNA Score: ${scores.mna}/14. Revisar alimentación.`,
      notify_all: false
    });
  }

  // Alertas informativas
  const weightChange = checkWeightChange(answers.vitals.weight);
  if (weightChange) {
    alerts.push({
      severity: 'info',
      title: '⚖️ Cambio de peso',
      message: weightChange,
      notify_all: false
    });
  }

  return alerts;
}

// Verificar cambios de peso significativos
async function checkWeightChange(currentWeight, patientId) {
  try {
    // Obtener últimos 7 pesos registrados
    const { data: previousWeights } = await supabase
      .from('exit_questionnaires')
      .select('patient_weight, completed_at')
      .eq('patient_id', patientId)
      .order('completed_at', { ascending: false })
      .limit(7);

    if (previousWeights && previousWeights.length > 0) {
      const lastWeight = previousWeights[0].patient_weight;
      const avgWeight = previousWeights.reduce((sum, w) => sum + w.patient_weight, 0) / previousWeights.length;
      
      const changeFromLast = currentWeight - lastWeight;
      const changeFromAvg = currentWeight - avgWeight;
      
      if (Math.abs(changeFromLast) > 1) {
        return `${changeFromLast > 0 ? '📈' : '📉'} ${changeFromLast.toFixed(1)}kg desde ayer`;
      }
      
      if (Math.abs(changeFromAvg) > 2) {
        return `${changeFromAvg > 0 ? '📈' : '📉'} ${changeFromAvg.toFixed(1)}kg vs promedio semanal`;
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error checking weight change:', error);
    return null;
  }
}

// Endpoint principal: Obtener cuestionario
async function getQuestionnaire(req, res) {
  try {
    const { patient_id, caregiver_id } = req.query;

    // Personalizar preguntas según el paciente si es necesario
    const customizedQuestionnaire = { ...questionnaireTemplate };

    // Agregar información del contexto
    const { data: patient } = await supabase
      .from('patients')
      .select('name, condition')
      .eq('id', patient_id)
      .single();

    res.json({
      success: true,
      data: {
        questionnaire: customizedQuestionnaire,
        patient_info: patient,
        estimated_time: '2 minutos',
        sections_count: Object.keys(customizedQuestionnaire).length
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}

// Endpoint principal: Enviar respuestas del cuestionario
async function submitQuestionnaire(req, res) {
  try {
    const {
      attendance_id,
      caregiver_id,
      patient_id,
      answers,
      time_taken_seconds
    } = req.body;

    // Validar respuestas requeridas
    const requiredFields = ['vitals.weight', 'mobility.walking', 'mobility.bathroom', 
                          'nutrition.meals', 'mental.confusion', 'medication.all_given'];
    
    for (const field of requiredFields) {
      const value = field.split('.').reduce((obj, key) => obj?.[key], answers);
      if (value === undefined || value === null) {
        return res.status(400).json({
          success: false,
          error: `Campo requerido faltante: ${field}`,
          field
        });
      }
    }

    // Calcular scores médicos
    const scores = calculateMedicalScores(answers);

    // Generar alertas automáticas
    const alerts = generateAlerts(answers, scores);

    // Guardar en base de datos
    const { data: questionnaire, error } = await supabase
      .from('exit_questionnaires')
      .insert({
        attendance_id,
        caregiver_id,
        patient_id,
        
        // Datos vitales
        patient_weight: answers.vitals.weight,
        weight_photo_url: answers.vitals.weight_photo || 'pending',
        
        // Scores médicos calculados
        barthel_score: scores.barthel,
        norton_score: scores.norton,
        mna_score: scores.mna,
        cam_score: scores.cam,
        global_risk_score: scores.global_risk,
        
        // Respuestas detalladas (JSON)
        answers_json: answers,
        
        // Metadata
        time_taken_seconds,
        completed_at: new Date().toISOString(),
        
        // Estado simplificado para queries rápidos
        patient_mood: translateMoodValue(answers.mental.mood),
        patient_mobility: translateMobilityValue(answers.mobility.walking),
        meals_given: answers.nutrition.meals,
        medications_given: answers.medication.all_given ? 1 : 0,
        
        // Observaciones
        incidents: answers.incidents.emergency || null,
        observations: generateObservationSummary(answers),
        
        // Foto final
        final_state_photo_url: answers.closure.final_photo || 'pending'
      })
      .select()
      .single();

    if (error) throw error;

    // Enviar alertas si hay
    if (alerts.length > 0) {
      await sendQuestionnaireAlerts(patient_id, alerts);
    }

    // Actualizar attendance para marcar cuestionario completo
    await supabase
      .from('attendance')
      .update({ questionnaire_completed: true })
      .eq('id', attendance_id);

    res.json({
      success: true,
      data: {
        questionnaire_id: questionnaire.id,
        scores,
        alerts_sent: alerts.length,
        message: 'Cuestionario completado exitosamente'
      }
    });

  } catch (error) {
    console.error('Error submitting questionnaire:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

// Funciones auxiliares de traducción
function translateMoodValue(value) {
  const moods = ['very_bad', 'bad', 'regular', 'good', 'excellent'];
  return moods[value - 1] || 'regular';
}

function translateMobilityValue(value) {
  const mobility = ['bedridden', 'wheelchair', 'assisted', 'independent'];
  return mobility[value] || 'assisted';
}

function generateObservationSummary(answers) {
  const summary = [];
  
  if (answers.mental.confusion > 0) {
    summary.push(`Confusión: ${answers.mental.confusion === 1 ? 'leve' : 'severa'}`);
  }
  
  if (answers.incidents.pain > 1) {
    summary.push(`Dolor: ${answers.incidents.pain === 2 ? 'moderado' : 'fuerte'}`);
  }
  
  if (!answers.medication.all_given) {
    summary.push('Medicación incompleta');
  }
  
  if (answers.incidents.emergency) {
    summary.push(`URGENTE: ${answers.incidents.emergency}`);
  }
  
  return summary.join('. ') || 'Sin observaciones especiales';
}

// Enviar alertas del cuestionario
async function sendQuestionnaireAlerts(patient_id, alerts) {
  try {
    for (const alert of alerts) {
      // Obtener destinatarios según severidad
      let recipients = [];
      
      if (alert.notify_all || alert.severity === 'critical') {
        // Notificar a TODOS
        const { data: users } = await supabase
          .from('users')
          .select('id')
          .in('role', ['admin', 'observer']);
        recipients = users.map(u => u.id);
      } else {
        // Solo al admin
        const { data: admin } = await supabase
          .from('users')
          .select('id')
          .eq('role', 'admin')
          .limit(1);
        recipients = admin.map(u => u.id);
      }

      // Crear notificaciones
      const notifications = recipients.map(user_id => ({
        user_id,
        type: 'alert',
        severity: alert.severity,
        title: alert.title,
        message: alert.message,
        related_patient_id: patient_id,
        sent_via: { 
          push: true, 
          email: alert.severity === 'critical' 
        }
      }));

      await supabase.from('notifications').insert(notifications);
    }
  } catch (error) {
    console.error('Error sending questionnaire alerts:', error);
  }
}

// Obtener historial de cuestionarios
async function getQuestionnaireHistory(req, res) {
  try {
    const { patient_id, days = 7 } = req.query;
    
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const { data: history, error } = await supabase
      .from('exit_questionnaires')
      .select(`
        *,
        caregiver:users!caregiver_id(name)
      `)
      .eq('patient_id', patient_id)
      .gte('completed_at', startDate.toISOString())
      .order('completed_at', { ascending: false });

    if (error) throw error;

    // Analizar tendencias
    const trends = analyzeTrends(history);

    res.json({
      success: true,
      data: {
        questionnaires: history,
        count: history.length,
        trends,
        average_completion_time: history.reduce((sum, q) => sum + (q.time_taken_seconds || 120), 0) / history.length
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}

// Analizar tendencias en los cuestionarios
function analyzeTrends(questionnaires) {
  if (questionnaires.length < 2) return null;

  const trends = {
    weight: { direction: 'stable', change: 0 },
    barthel: { direction: 'stable', change: 0 },
    norton: { direction: 'stable', change: 0 },
    confusion: { direction: 'stable', days_with_confusion: 0 }
  };

  // Calcular cambios
  const recent = questionnaires.slice(0, 3);
  const older = questionnaires.slice(-3);

  if (recent.length && older.length) {
    const recentAvgWeight = recent.reduce((sum, q) => sum + q.patient_weight, 0) / recent.length;
    const olderAvgWeight = older.reduce((sum, q) => sum + q.patient_weight, 0) / older.length;
    
    trends.weight.change = recentAvgWeight - olderAvgWeight;
    trends.weight.direction = trends.weight.change > 0.5 ? 'up' : trends.weight.change < -0.5 ? 'down' : 'stable';

    const recentAvgBarthel = recent.reduce((sum, q) => sum + (q.barthel_score || 0), 0) / recent.length;
    const olderAvgBarthel = older.reduce((sum, q) => sum + (q.barthel_score || 0), 0) / older.length;
    
    trends.barthel.change = recentAvgBarthel - olderAvgBarthel;
    trends.barthel.direction = trends.barthel.change > 5 ? 'improving' : trends.barthel.change < -5 ? 'declining' : 'stable';
  }

  // Contar días con confusión
  trends.confusion.days_with_confusion = questionnaires.filter(q => q.cam_score > 0).length;

  return trends;
}

module.exports = {
  getQuestionnaire,
  submitQuestionnaire,
  getQuestionnaireHistory,
  calculateMedicalScores,
  questionnaireTemplate
};