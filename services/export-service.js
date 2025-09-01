const fs = require('fs').promises;
const path = require('path');
const archiver = require('archiver');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const { createWriteStream } = require('fs');
const { pipeline } = require('stream').promises;
const fetch = require('node-fetch');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

/**
 * Servicio de exportación completa de datos
 * CRÍTICO: Implementa requisito "La exportación debe incluir TODO"
 */
class ExportService {
  constructor(supabaseClient) {
    this.supabase = supabaseClient;
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
    this.model = this.genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
    this.exportPath = path.join(__dirname, '../../exports');
  }

  /**
   * Exporta TODOS los datos de un paciente en el período especificado
   * Incluye: fotos, datos, análisis IA, gráficos
   */
  async exportCompleteData(patientId, startDate, endDate, format = 'zip', userId) {
    console.log(`[EXPORT] Iniciando exportación completa para paciente ${patientId}`);
    
    // Crear directorio temporal para la exportación
    const exportId = `export_${patientId}_${Date.now()}`;
    const tempDir = path.join(this.exportPath, exportId);
    await fs.mkdir(tempDir, { recursive: true });

    try {
      // 1. Recopilar TODOS los datos
      const allData = await this.collectAllData(patientId, startDate, endDate);
      
      // 2. Descargar TODAS las fotos
      const photosDir = path.join(tempDir, 'fotos');
      await this.downloadAllPhotos(allData.photos, photosDir);
      
      // 3. Generar análisis con IA
      const aiAnalysis = await this.generateAIAnalysis(allData);
      
      // 4. Crear reportes en múltiples formatos
      const reports = await this.generateReports(allData, aiAnalysis, tempDir);
      
      // 5. Empaquetar todo en ZIP
      const zipPath = await this.createCompleteZip(tempDir, exportId);
      
      // 6. Registrar auditoría
      await this.logExportAudit(patientId, userId, exportId, format);
      
      console.log(`[EXPORT] Exportación completa: ${zipPath}`);
      
      return {
        success: true,
        exportId,
        downloadUrl: `/api/exports/download/${exportId}`,
        size: await this.getFileSize(zipPath),
        contents: {
          totalPhotos: allData.photos.length,
          totalRecords: Object.values(allData).reduce((acc, arr) => acc + (Array.isArray(arr) ? arr.length : 0), 0),
          formats: ['pdf', 'excel', 'json', 'csv'],
          aiAnalysisIncluded: true
        }
      };
      
    } catch (error) {
      console.error('[EXPORT] Error:', error);
      throw error;
    }
  }

  /**
   * Recopila TODOS los datos del paciente
   */
  async collectAllData(patientId, startDate, endDate) {
    console.log('[EXPORT] Recopilando todos los datos...');
    
    const [
      patient,
      medications,
      medicationLogs,
      meals,
      hygieneLogs,
      activities,
      attendance,
      dailyReports,
      photos,
      notifications,
      caregivers,
      weights
    ] = await Promise.all([
      // Datos del paciente
      this.supabase
        .from('patients')
        .select('*')
        .eq('id', patientId)
        .single(),
      
      // Medicamentos y administración
      this.supabase
        .from('medications')
        .select('*')
        .eq('patient_id', patientId),
      
      this.supabase
        .from('medication_logs')
        .select('*')
        .eq('patient_id', patientId)
        .gte('administered_at', startDate)
        .lte('administered_at', endDate),
      
      // Comidas
      this.supabase
        .from('meals')
        .select('*')
        .eq('patient_id', patientId)
        .gte('meal_date', startDate)
        .lte('meal_date', endDate),
      
      // Higiene
      this.supabase
        .from('hygiene_logs')
        .select('*')
        .eq('patient_id', patientId)
        .gte('logged_at', startDate)
        .lte('logged_at', endDate),
      
      // Actividades
      this.supabase
        .from('activities')
        .select('*')
        .eq('patient_id', patientId)
        .gte('activity_date', startDate)
        .lte('activity_date', endDate),
      
      // Asistencia
      this.supabase
        .from('attendance')
        .select('*')
        .eq('patient_id', patientId)
        .gte('check_in_time', startDate)
        .lte('check_in_time', endDate),
      
      // Reportes diarios
      this.supabase
        .from('daily_reports')
        .select('*')
        .eq('patient_id', patientId)
        .gte('report_date', startDate)
        .lte('report_date', endDate),
      
      // TODAS las fotos (crítico)
      this.supabase
        .from('photos')
        .select('*')
        .eq('patient_id', patientId)
        .gte('created_at', startDate)
        .lte('created_at', endDate),
      
      // Notificaciones
      this.supabase
        .from('notifications')
        .select('*')
        .eq('patient_id', patientId)
        .gte('created_at', startDate)
        .lte('created_at', endDate),
      
      // Cuidadoras asignadas
      this.supabase
        .from('patient_caregivers')
        .select('*, users!patient_caregivers_caregiver_id_fkey(*)')
        .eq('patient_id', patientId),
      
      // Pesos diarios (crítico para seguimiento)
      this.supabase
        .from('daily_reports')
        .select('report_date, weight, weight_photo_url')
        .eq('patient_id', patientId)
        .gte('report_date', startDate)
        .lte('report_date', endDate)
        .not('weight', 'is', null)
    ]);

    return {
      patient: patient.data,
      medications: medications.data || [],
      medicationLogs: medicationLogs.data || [],
      meals: meals.data || [],
      hygieneLogs: hygieneLogs.data || [],
      activities: activities.data || [],
      attendance: attendance.data || [],
      dailyReports: dailyReports.data || [],
      photos: photos.data || [],
      notifications: notifications.data || [],
      caregivers: caregivers.data || [],
      weights: weights.data || []
    };
  }

  /**
   * Descarga TODAS las fotos organizadas por categoría y fecha
   */
  async downloadAllPhotos(photos, photosDir) {
    if (!photos || photos.length === 0) {
      console.log('[EXPORT] No hay fotos para descargar');
      return;
    }

    console.log(`[EXPORT] Descargando ${photos.length} fotos...`);
    
    // Crear estructura de carpetas por categoría
    const categories = {
      'weight': 'peso',
      'medication': 'medicamentos',
      'meal': 'comidas',
      'hygiene': 'higiene',
      'activity': 'actividades',
      'final_state': 'estado_final',
      'other': 'otros'
    };

    for (const [key, folderName] of Object.entries(categories)) {
      await fs.mkdir(path.join(photosDir, folderName), { recursive: true });
    }

    // Descargar cada foto
    let downloadedCount = 0;
    for (const photo of photos) {
      try {
        const category = photo.category || 'other';
        const folderName = categories[category] || categories.other;
        
        // Crear nombre descriptivo
        const date = new Date(photo.created_at).toISOString().split('T')[0];
        const time = new Date(photo.created_at).toTimeString().split(' ')[0].replace(/:/g, '-');
        const fileName = `${date}_${time}_${photo.description || photo.id}.jpg`;
        const filePath = path.join(photosDir, folderName, fileName);
        
        // Descargar foto desde Supabase Storage
        if (photo.photo_url) {
          const { data, error } = await this.supabase.storage
            .from('photos')
            .download(photo.photo_url);
          
          if (data) {
            const buffer = await data.arrayBuffer();
            await fs.writeFile(filePath, Buffer.from(buffer));
            downloadedCount++;
            
            // Crear archivo de metadata
            const metadataPath = filePath.replace('.jpg', '_metadata.json');
            await fs.writeFile(metadataPath, JSON.stringify({
              id: photo.id,
              category: photo.category,
              description: photo.description,
              captured_at: photo.created_at,
              caregiver_id: photo.caregiver_id,
              location: photo.metadata?.location || null,
              verified: photo.is_verified || false,
              watermark: photo.has_watermark || false
            }, null, 2));
          }
        }
      } catch (error) {
        console.error(`[EXPORT] Error descargando foto ${photo.id}:`, error);
      }
    }

    console.log(`[EXPORT] Descargadas ${downloadedCount}/${photos.length} fotos`);
  }

  /**
   * Genera análisis con Gemini 2.5 Pro
   */
  async generateAIAnalysis(data) {
    console.log('[EXPORT] Generando análisis con IA...');
    
    try {
      const prompt = `
        Analiza los siguientes datos de cuidados de un adulto mayor y genera un informe médico profesional:
        
        DATOS DEL PACIENTE:
        ${JSON.stringify(data.patient, null, 2)}
        
        RESUMEN DEL PERÍODO:
        - Total de medicamentos administrados: ${data.medicationLogs.length}
        - Total de comidas registradas: ${data.meals.length}
        - Total de actividades realizadas: ${data.activities.length}
        - Total de días con asistencia: ${data.attendance.length}
        - Total de fotos documentadas: ${data.photos.length}
        
        MEDICAMENTOS:
        ${JSON.stringify(data.medications, null, 2)}
        
        ADMINISTRACIÓN DE MEDICAMENTOS (últimos 10):
        ${JSON.stringify(data.medicationLogs.slice(-10), null, 2)}
        
        EVOLUCIÓN DE PESO:
        ${JSON.stringify(data.weights, null, 2)}
        
        REPORTES DIARIOS (últimos 5):
        ${JSON.stringify(data.dailyReports.slice(-5), null, 2)}
        
        Por favor genera:
        1. RESUMEN EJECUTIVO del estado del paciente
        2. ANÁLISIS DE ADHERENCIA a medicamentos (porcentajes y patrones)
        3. EVALUACIÓN NUTRICIONAL basada en comidas y peso
        4. PATRONES DE COMPORTAMIENTO detectados
        5. ALERTAS Y RECOMENDACIONES médicas
        6. SUGERENCIAS PARA MEJORAR el cuidado
        7. INDICADORES DE RIESGO identificados
        
        Formato: Profesional, para presentar a médicos y familiares.
      `;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const analysis = response.text();
      
      return {
        generated_at: new Date().toISOString(),
        model: 'gemini-2.0-flash-exp',
        analysis: analysis,
        data_points_analyzed: {
          medications: data.medicationLogs.length,
          meals: data.meals.length,
          activities: data.activities.length,
          photos: data.photos.length,
          daily_reports: data.dailyReports.length
        }
      };
      
    } catch (error) {
      console.error('[EXPORT] Error en análisis IA:', error);
      return {
        generated_at: new Date().toISOString(),
        error: 'No se pudo generar el análisis con IA',
        fallback: this.generateBasicAnalysis(data)
      };
    }
  }

  /**
   * Genera análisis básico sin IA (fallback)
   */
  generateBasicAnalysis(data) {
    const totalDays = data.dailyReports.length || 1;
    const medicationAdherence = (data.medicationLogs.length / (data.medications.length * totalDays * 2)) * 100;
    const avgPhotosPerDay = data.photos.length / totalDays;
    
    return {
      summary: {
        total_days_monitored: totalDays,
        medication_adherence_percentage: Math.min(medicationAdherence, 100).toFixed(1),
        average_photos_per_day: avgPhotosPerDay.toFixed(1),
        total_caregiver_visits: data.attendance.length,
        total_activities_completed: data.activities.length
      },
      alerts: this.detectAlerts(data),
      recommendations: this.generateRecommendations(data)
    };
  }

  /**
   * Detecta alertas automáticas
   */
  detectAlerts(data) {
    const alerts = [];
    
    // Alerta de pocas fotos
    const avgPhotosPerDay = data.photos.length / (data.dailyReports.length || 1);
    if (avgPhotosPerDay < 10) {
      alerts.push({
        type: 'critical',
        message: `Promedio de fotos diarias (${avgPhotosPerDay.toFixed(1)}) por debajo del mínimo requerido (10)`
      });
    }
    
    // Alerta de medicamentos perdidos
    const missedMeds = data.medicationLogs.filter(log => log.status === 'missed');
    if (missedMeds.length > 0) {
      alerts.push({
        type: 'important',
        message: `${missedMeds.length} medicamentos no administrados en el período`
      });
    }
    
    // Alerta de peso
    if (data.weights.length >= 2) {
      const firstWeight = data.weights[0].weight;
      const lastWeight = data.weights[data.weights.length - 1].weight;
      const change = ((lastWeight - firstWeight) / firstWeight) * 100;
      
      if (Math.abs(change) > 5) {
        alerts.push({
          type: 'important',
          message: `Cambio de peso significativo: ${change.toFixed(1)}% en el período`
        });
      }
    }
    
    return alerts;
  }

  /**
   * Genera recomendaciones automáticas
   */
  generateRecommendations(data) {
    const recommendations = [];
    
    if (data.photos.length / (data.dailyReports.length || 1) < 10) {
      recommendations.push('Aumentar la frecuencia de documentación fotográfica a mínimo 10 fotos diarias');
    }
    
    if (data.weights.length < data.dailyReports.length) {
      recommendations.push('Implementar registro de peso diario obligatorio');
    }
    
    if (data.activities.length < data.dailyReports.length * 2) {
      recommendations.push('Incrementar las actividades de estimulación cognitiva y física');
    }
    
    return recommendations;
  }

  /**
   * Genera reportes en múltiples formatos
   */
  async generateReports(data, aiAnalysis, tempDir) {
    console.log('[EXPORT] Generando reportes en múltiples formatos...');
    
    const reports = {};
    
    // 1. PDF Médico
    reports.pdf = await this.generatePDFReport(data, aiAnalysis, tempDir);
    
    // 2. Excel detallado
    reports.excel = await this.generateExcelReport(data, aiAnalysis, tempDir);
    
    // 3. JSON completo
    reports.json = await this.generateJSONReport(data, aiAnalysis, tempDir);
    
    // 4. CSV para análisis
    reports.csv = await this.generateCSVReports(data, tempDir);
    
    return reports;
  }

  /**
   * Genera PDF médico profesional
   */
  async generatePDFReport(data, aiAnalysis, tempDir) {
    const pdfPath = path.join(tempDir, 'reporte_medico.pdf');
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const stream = createWriteStream(pdfPath);
    doc.pipe(stream);
    
    // Portada
    doc.fontSize(24).text('REPORTE MÉDICO DE CUIDADOS', { align: 'center' });
    doc.fontSize(18).text(data.patient.full_name, { align: 'center' });
    doc.fontSize(12).text(`Generado: ${new Date().toLocaleDateString('es-ES')}`, { align: 'center' });
    doc.moveDown(2);
    
    // Información del paciente
    doc.fontSize(16).text('INFORMACIÓN DEL PACIENTE', { underline: true });
    doc.fontSize(12);
    doc.text(`Nombre: ${data.patient.full_name}`);
    doc.text(`Edad: ${data.patient.age || 'No especificada'} años`);
    doc.text(`Condiciones: ${data.patient.medical_conditions || 'Ninguna registrada'}`);
    doc.text(`Alergias: ${data.patient.allergies || 'Ninguna registrada'}`);
    doc.moveDown();
    
    // Resumen del período
    doc.fontSize(16).text('RESUMEN DEL PERÍODO', { underline: true });
    doc.fontSize(12);
    doc.text(`Total de días monitoreados: ${data.dailyReports.length}`);
    doc.text(`Medicamentos administrados: ${data.medicationLogs.length}`);
    doc.text(`Comidas registradas: ${data.meals.length}`);
    doc.text(`Actividades realizadas: ${data.activities.length}`);
    doc.text(`Fotos documentadas: ${data.photos.length}`);
    doc.moveDown();
    
    // Análisis IA
    if (aiAnalysis.analysis) {
      doc.addPage();
      doc.fontSize(16).text('ANÁLISIS MÉDICO CON INTELIGENCIA ARTIFICIAL', { underline: true });
      doc.fontSize(11);
      doc.text(aiAnalysis.analysis, { align: 'justify' });
    }
    
    // Medicamentos
    doc.addPage();
    doc.fontSize(16).text('CONTROL DE MEDICAMENTOS', { underline: true });
    doc.fontSize(11);
    
    data.medications.forEach(med => {
      doc.text(`\n${med.name} - ${med.dosage}`);
      doc.text(`Frecuencia: ${med.frequency}`);
      doc.text(`Horarios: ${med.schedule_times.join(', ')}`);
      
      const logs = data.medicationLogs.filter(log => log.medication_id === med.id);
      const adherence = (logs.filter(l => l.status === 'taken').length / logs.length) * 100 || 0;
      doc.text(`Adherencia: ${adherence.toFixed(1)}%`);
    });
    
    // Evolución de peso
    if (data.weights.length > 0) {
      doc.addPage();
      doc.fontSize(16).text('EVOLUCIÓN DE PESO', { underline: true });
      doc.fontSize(11);
      
      data.weights.forEach(w => {
        doc.text(`${new Date(w.report_date).toLocaleDateString('es-ES')}: ${w.weight} kg`);
      });
    }
    
    // Finalizar PDF
    doc.end();
    await new Promise(resolve => stream.on('finish', resolve));
    
    return pdfPath;
  }

  /**
   * Genera Excel con múltiples hojas
   */
  async generateExcelReport(data, aiAnalysis, tempDir) {
    const excelPath = path.join(tempDir, 'reporte_completo.xlsx');
    const workbook = new ExcelJS.Workbook();
    
    // Hoja 1: Resumen
    const summarySheet = workbook.addWorksheet('Resumen');
    summarySheet.columns = [
      { header: 'Métrica', key: 'metric', width: 30 },
      { header: 'Valor', key: 'value', width: 20 }
    ];
    
    summarySheet.addRows([
      { metric: 'Paciente', value: data.patient.full_name },
      { metric: 'Período', value: `${data.dailyReports.length} días` },
      { metric: 'Total Medicamentos', value: data.medicationLogs.length },
      { metric: 'Total Comidas', value: data.meals.length },
      { metric: 'Total Actividades', value: data.activities.length },
      { metric: 'Total Fotos', value: data.photos.length },
      { metric: 'Promedio Fotos/Día', value: (data.photos.length / data.dailyReports.length).toFixed(1) }
    ]);
    
    // Hoja 2: Medicamentos
    const medsSheet = workbook.addWorksheet('Medicamentos');
    medsSheet.columns = [
      { header: 'Fecha', key: 'date', width: 15 },
      { header: 'Hora', key: 'time', width: 10 },
      { header: 'Medicamento', key: 'medication', width: 25 },
      { header: 'Estado', key: 'status', width: 15 },
      { header: 'Cuidadora', key: 'caregiver', width: 20 }
    ];
    
    data.medicationLogs.forEach(log => {
      const med = data.medications.find(m => m.id === log.medication_id);
      medsSheet.addRow({
        date: new Date(log.administered_at).toLocaleDateString('es-ES'),
        time: new Date(log.administered_at).toLocaleTimeString('es-ES'),
        medication: med?.name || 'Desconocido',
        status: log.status === 'taken' ? 'Administrado' : 'No administrado',
        caregiver: log.caregiver_id || 'No registrado'
      });
    });
    
    // Hoja 3: Comidas
    const mealsSheet = workbook.addWorksheet('Comidas');
    mealsSheet.columns = [
      { header: 'Fecha', key: 'date', width: 15 },
      { header: 'Tipo', key: 'type', width: 15 },
      { header: 'Descripción', key: 'description', width: 40 },
      { header: 'Completado', key: 'completed', width: 15 }
    ];
    
    data.meals.forEach(meal => {
      mealsSheet.addRow({
        date: new Date(meal.meal_date).toLocaleDateString('es-ES'),
        type: meal.meal_type,
        description: meal.description || 'Sin descripción',
        completed: meal.was_eaten ? 'Sí' : 'No'
      });
    });
    
    // Hoja 4: Pesos
    const weightsSheet = workbook.addWorksheet('Evolución Peso');
    weightsSheet.columns = [
      { header: 'Fecha', key: 'date', width: 15 },
      { header: 'Peso (kg)', key: 'weight', width: 15 },
      { header: 'Variación', key: 'change', width: 15 }
    ];
    
    let previousWeight = null;
    data.weights.forEach(w => {
      const change = previousWeight ? w.weight - previousWeight : 0;
      weightsSheet.addRow({
        date: new Date(w.report_date).toLocaleDateString('es-ES'),
        weight: w.weight,
        change: change > 0 ? `+${change.toFixed(1)}` : change.toFixed(1)
      });
      previousWeight = w.weight;
    });
    
    // Hoja 5: Análisis IA
    if (aiAnalysis.analysis) {
      const aiSheet = workbook.addWorksheet('Análisis IA');
      aiSheet.columns = [
        { header: 'Análisis Médico con Inteligencia Artificial', key: 'analysis', width: 100 }
      ];
      
      // Dividir el análisis en líneas para mejor legibilidad
      const lines = aiAnalysis.analysis.split('\n');
      lines.forEach(line => {
        if (line.trim()) {
          aiSheet.addRow({ analysis: line });
        }
      });
    }
    
    // Guardar Excel
    await workbook.xlsx.writeFile(excelPath);
    
    return excelPath;
  }

  /**
   * Genera JSON completo
   */
  async generateJSONReport(data, aiAnalysis, tempDir) {
    const jsonPath = path.join(tempDir, 'datos_completos.json');
    
    const completeData = {
      export_metadata: {
        generated_at: new Date().toISOString(),
        version: '1.0',
        includes_ai_analysis: true,
        total_records: Object.values(data).reduce((acc, val) => 
          acc + (Array.isArray(val) ? val.length : 1), 0
        )
      },
      patient: data.patient,
      medications: data.medications,
      medication_logs: data.medicationLogs,
      meals: data.meals,
      hygiene_logs: data.hygieneLogs,
      activities: data.activities,
      attendance: data.attendance,
      daily_reports: data.dailyReports,
      photos_metadata: data.photos.map(p => ({
        id: p.id,
        category: p.category,
        description: p.description,
        created_at: p.created_at,
        verified: p.is_verified
      })),
      weights: data.weights,
      caregivers: data.caregivers,
      notifications: data.notifications,
      ai_analysis: aiAnalysis
    };
    
    await fs.writeFile(jsonPath, JSON.stringify(completeData, null, 2));
    
    return jsonPath;
  }

  /**
   * Genera archivos CSV
   */
  async generateCSVReports(data, tempDir) {
    const csvDir = path.join(tempDir, 'csv');
    await fs.mkdir(csvDir, { recursive: true });
    
    // CSV de medicamentos
    const medsCSV = data.medicationLogs.map(log => {
      const med = data.medications.find(m => m.id === log.medication_id);
      return [
        new Date(log.administered_at).toISOString(),
        med?.name || '',
        log.status,
        log.caregiver_id || ''
      ].join(',');
    });
    
    await fs.writeFile(
      path.join(csvDir, 'medicamentos.csv'),
      'Fecha,Medicamento,Estado,Cuidadora\n' + medsCSV.join('\n')
    );
    
    // CSV de comidas
    const mealsCSV = data.meals.map(meal => [
      new Date(meal.meal_date).toISOString(),
      meal.meal_type,
      meal.description || '',
      meal.was_eaten ? 'Si' : 'No'
    ].join(','));
    
    await fs.writeFile(
      path.join(csvDir, 'comidas.csv'),
      'Fecha,Tipo,Descripcion,Completado\n' + mealsCSV.join('\n')
    );
    
    // CSV de pesos
    const weightsCSV = data.weights.map(w => [
      new Date(w.report_date).toISOString(),
      w.weight
    ].join(','));
    
    await fs.writeFile(
      path.join(csvDir, 'pesos.csv'),
      'Fecha,Peso_kg\n' + weightsCSV.join('\n')
    );
    
    return csvDir;
  }

  /**
   * Crea ZIP final con TODO el contenido
   */
  async createCompleteZip(tempDir, exportId) {
    const zipPath = path.join(this.exportPath, `${exportId}.zip`);
    const output = createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    
    return new Promise((resolve, reject) => {
      output.on('close', () => {
        console.log(`[EXPORT] ZIP creado: ${archive.pointer()} bytes`);
        resolve(zipPath);
      });
      
      archive.on('error', reject);
      
      archive.pipe(output);
      
      // Agregar todo el contenido del directorio temporal
      archive.directory(tempDir, false);
      
      // Agregar README
      archive.append(this.generateReadme(), { name: 'LEEME.txt' });
      
      archive.finalize();
    });
  }

  /**
   * Genera README para el ZIP
   */
  generateReadme() {
    return `
EXPORTACIÓN COMPLETA DE DATOS - SISTEMA DE SUPERVISIÓN DE CUIDADOS
================================================================

Este archivo ZIP contiene la exportación completa de todos los datos del paciente.

CONTENIDO:
----------
/fotos/              - Todas las fotos organizadas por categoría
  /peso/            - Fotos de báscula con peso
  /medicamentos/    - Fotos de administración de medicamentos
  /comidas/         - Fotos de comidas
  /higiene/         - Fotos de higiene
  /actividades/     - Fotos de actividades
  /estado_final/    - Fotos del estado final del día
  /otros/           - Otras fotos

/csv/               - Datos en formato CSV para análisis
  medicamentos.csv  - Registro de medicamentos
  comidas.csv       - Registro de comidas
  pesos.csv         - Evolución del peso

reporte_medico.pdf  - Reporte médico profesional con análisis IA
reporte_completo.xlsx - Datos completos en Excel con múltiples hojas
datos_completos.json - Todos los datos en formato JSON

ANÁLISIS CON INTELIGENCIA ARTIFICIAL:
-------------------------------------
Este reporte incluye análisis generado por Gemini 2.5 Pro que evalúa:
- Adherencia a medicamentos
- Patrones de comportamiento
- Alertas y recomendaciones médicas
- Indicadores de riesgo

IMPORTANTE:
-----------
- Todas las fotos incluyen metadata con información de captura
- Los datos están completos hasta la fecha de exportación
- Este archivo contiene información médica confidencial

Generado: ${new Date().toLocaleString('es-ES')}
Sistema de Supervisión de Cuidados para Adultos Mayores v1.0
`;
  }

  /**
   * Registra auditoría de exportación
   */
  async logExportAudit(patientId, userId, exportId, format) {
    await this.supabase
      .from('audit_logs')
      .insert({
        user_id: userId,
        action: 'data_export',
        entity_type: 'patient',
        entity_id: patientId,
        details: {
          export_id: exportId,
          format: format,
          timestamp: new Date().toISOString()
        }
      });
  }

  /**
   * Obtiene tamaño del archivo
   */
  async getFileSize(filePath) {
    const stats = await fs.stat(filePath);
    const sizeInMB = stats.size / (1024 * 1024);
    return `${sizeInMB.toFixed(2)} MB`;
  }
}

module.exports = ExportService;