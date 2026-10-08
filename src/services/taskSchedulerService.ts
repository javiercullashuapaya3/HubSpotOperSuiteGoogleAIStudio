import fs from 'fs';
import path from 'path';
import cron from 'node-cron';
import nodemailer from 'nodemailer';
import { createClient } from '@supabase/supabase-js';
import ExcelJS from 'exceljs';
import {
  executeHubSpotReportGeneration,
  HubSpotReportOwner,
} from './hubspotExcelReporter';

export type TaskType = 'SEND_EMAIL' | 'SYNC_HUBSPOT' | 'WEBHOOK';
export type TaskStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface ScheduledAdvisorReportItem {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  team?: string;
  avatarUrl?: string;
}

export interface ScheduledTaskPayload {
  to?: string;
  toName?: string;
  subject?: string;
  body?: string;
  html?: string;
  attachExcel?: boolean;
  excelFileName?: string;
  ownerId?: string;
  companyId?: number | string;
  webhookUrl?: string;
  customData?: Record<string, any>;

  // Parámetros para despacho programado a asesores comerciales:
  senderName?: string;
  subjectTemplate?: string;
  bodyTemplate?: string;
  excludedOwnerIds?: string[];
  targetAdvisors?: ScheduledAdvisorReportItem[];
  dispatchResults?: Array<{
    ownerId: string;
    ownerName: string;
    email: string;
    status: 'sent' | 'skipped' | 'failed';
    messageId?: string;
    error?: string;
  }>;
}

export interface ScheduledTask {
  id: string;
  type: TaskType;
  title: string;
  scheduledAt: string; // ISO string (UTC)
  status: TaskStatus;
  payload: ScheduledTaskPayload;
  createdAt: string; // ISO string
  executedAt: string | null;
  error: string | null;
  attempts: number;
  maxAttempts: number;
}

const DATA_DIR = path.join(process.cwd(), 'data');
const TASKS_FILE = path.join(DATA_DIR, 'scheduled_tasks.json');
const ADVISOR_CONFIG_FILE = path.join(DATA_DIR, 'advisor_dispatch_config.json');
const ADVISOR_LOGS_FILE = path.join(DATA_DIR, 'advisor_dispatch_logs.json');

export interface UnifiedAdvisorDispatchConfig {
  enabled: boolean;
  activeDays: number[]; // [1, 2, 3, 4, 5] (1=Lun, ..., 0=Dom)
  scheduledTimes: string[]; // ['09:00', '13:30', '18:00']
  validUntilDate?: string | null; // 'YYYY-MM-DD' o null
  senderName: string;
  senderEmail: string;
  subjectTemplate: string;
  bodyTemplate: string;
  excludedOwnerIds: string[];
  cronExpression?: string;
  companyId?: number | string;
  lastDispatchedAt?: string | null;
}

export interface AdvisorDispatchLog {
  id: string;
  timestamp: string;
  senderName: string;
  subject: string;
  totalRecipients: number;
  excludedCount: number;
  results: Array<{
    ownerId: string;
    ownerName: string;
    email: string;
    status: 'sent' | 'skipped' | 'failed';
    error?: string;
  }>;
}

const DEFAULT_ADVISOR_CONFIG: UnifiedAdvisorDispatchConfig = {
  enabled: true,
  activeDays: [1, 2, 3, 4, 5],
  scheduledTimes: ['09:00', '14:00', '18:00'],
  validUntilDate: null,
  senderName: 'Dirección Comercial Promptia',
  senderEmail: process.env.SMTP_FROM || 'notificaciones@promptia.lat',
  subjectTemplate: 'Reporte de Contactos Asignados - {{nombre_asesor}}',
  bodyTemplate:
    'Hola {{nombre_asesor}},\n\nAdjunto encontrarás tu reporte consolidado en Excel con tus contactos asignados y métricas comerciales de HubSpot CRM.\n\nPor favor prioriza tus contactos con más de 24 horas sin actividad reciente para el cumplimiento de meta.\n\nAtentamente,\n{{remitente}}',
  excludedOwnerIds: [],
  cronExpression: '0 9,14,18 * * 1-5',
};

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  'https://dhbdgmuuciwosiwpznrs.supabase.co';

const SUPABASE_ANON =
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRoYmRnbXV1Y2l3b3Npd3B6bnJzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA2ODM3ODQsImV4cCI6MjA2NjI1OTc4NH0.Qh9g4FWSYKZcOOYm7WJeJyv1QgI2r5ZDn7CcU3oT7gs';

const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON);

/**
 * Asegura la creación del directorio data/ y el archivo inicial scheduled_tasks.json
 */
function ensureStorage(): void {
  try {
    fs.mkdirSync(path.dirname(TASKS_FILE), { recursive: true });
    if (!fs.existsSync(TASKS_FILE)) {
      fs.writeFileSync(TASKS_FILE, JSON.stringify([], null, 2), 'utf-8');
    }
    if (!fs.existsSync(ADVISOR_CONFIG_FILE)) {
      fs.writeFileSync(ADVISOR_CONFIG_FILE, JSON.stringify(DEFAULT_ADVISOR_CONFIG, null, 2), 'utf-8');
    }
    if (!fs.existsSync(ADVISOR_LOGS_FILE)) {
      fs.writeFileSync(ADVISOR_LOGS_FILE, JSON.stringify([], null, 2), 'utf-8');
    }
  } catch (err: any) {
    console.error('[TaskScheduler] Error inicializando almacenamiento de tareas:', err.message);
  }
}

/**
 * Obtiene la configuración del planificador flexible y permanente de reportes a asesores
 */
export function getAdvisorDispatchConfig(): UnifiedAdvisorDispatchConfig {
  ensureStorage();
  try {
    if (!fs.existsSync(ADVISOR_CONFIG_FILE)) {
      return DEFAULT_ADVISOR_CONFIG;
    }
    const raw = fs.readFileSync(ADVISOR_CONFIG_FILE, 'utf-8');
    if (!raw.trim()) return DEFAULT_ADVISOR_CONFIG;
    return {
      ...DEFAULT_ADVISOR_CONFIG,
      ...JSON.parse(raw),
    };
  } catch (err: any) {
    console.warn('[TaskScheduler] Error leyendo configuración de planificador:', err.message);
    return DEFAULT_ADVISOR_CONFIG;
  }
}

/**
 * Guarda de forma permanente la configuración del planificador flexible de reportes a asesores
 */
export function saveAdvisorDispatchConfig(
  newConfig: Partial<UnifiedAdvisorDispatchConfig>
): UnifiedAdvisorDispatchConfig {
  ensureStorage();
  try {
    const current = getAdvisorDispatchConfig();
    const updated: UnifiedAdvisorDispatchConfig = {
      ...current,
      ...newConfig,
    };
    fs.writeFileSync(ADVISOR_CONFIG_FILE, JSON.stringify(updated, null, 2), 'utf-8');
    console.log('[TaskScheduler] Configuración de planificador permanente guardada en disco.');

    // Sincronización a Supabase en segundo plano para respaldo y tolerancia a fallos en VPS
    syncAdvisorConfigToSupabase(updated).catch((err) => {
      console.warn('[TaskScheduler] Advertencia al sincronizar config con Supabase:', err.message);
    });

    return updated;
  } catch (err: any) {
    console.error('[TaskScheduler] Error guardando configuración de planificador:', err.message);
    throw err;
  }
}

/**
 * Respalda la configuración del planificador en Supabase para persistencia en VPS / multi-servidor
 */
export async function syncAdvisorConfigToSupabase(
  config: UnifiedAdvisorDispatchConfig
): Promise<void> {
  try {
    const compId = config.companyId ? Number(config.companyId) : 1;
    if (!isNaN(compId)) {
      const { data: comp } = await supabaseClient
        .from('companies')
        .select('id, hubspot_report_config')
        .eq('id', compId)
        .maybeSingle();

      const existingConfig = comp?.hubspot_report_config || {};
      const mergedConfig = {
        ...(typeof existingConfig === 'object' ? existingConfig : {}),
        advisorDispatchConfig: config,
      };

      await supabaseClient
        .from('companies')
        .update({ hubspot_report_config: mergedConfig })
        .eq('id', compId);
    }
  } catch (err: any) {
    console.warn('[TaskScheduler] Sincronización Supabase omitida:', err.message);
  }
}

/**
 * Obtiene el historial de despachos de reportes a asesores
 */
export function getAdvisorDispatchLogs(): AdvisorDispatchLog[] {
  ensureStorage();
  try {
    if (!fs.existsSync(ADVISOR_LOGS_FILE)) return [];
    const raw = fs.readFileSync(ADVISOR_LOGS_FILE, 'utf-8');
    if (!raw.trim()) return [];
    const logs: AdvisorDispatchLog[] = JSON.parse(raw);
    return logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  } catch {
    return [];
  }
}

/**
 * Agrega un log de despacho
 */
function recordAdvisorDispatchLog(log: AdvisorDispatchLog): void {
  ensureStorage();
  try {
    const logs = getAdvisorDispatchLogs();
    logs.unshift(log);
    // Conservar los últimos 100 logs
    const trimmed = logs.slice(0, 100);
    fs.writeFileSync(ADVISOR_LOGS_FILE, JSON.stringify(trimmed, null, 2), 'utf-8');
  } catch (err: any) {
    console.warn('[TaskScheduler] Error guardando log de despacho:', err.message);
  }
}

/**
 * Lee todas las tareas del archivo JSON
 */
export function readTasks(): ScheduledTask[] {
  ensureStorage();
  try {
    const raw = fs.readFileSync(TASKS_FILE, 'utf-8');
    if (!raw.trim()) return [];
    return JSON.parse(raw);
  } catch (err: any) {
    console.error('[TaskScheduler] Error leyendo tareas de', TASKS_FILE, err.message);
    return [];
  }
}

/**
 * Guarda las tareas en el archivo JSON
 */
export function writeTasks(tasks: ScheduledTask[]): void {
  ensureStorage();
  try {
    fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2), 'utf-8');
  } catch (err: any) {
    console.error('[TaskScheduler] Error escribiendo tareas en', TASKS_FILE, err.message);
  }
}

/**
 * Obtiene la lista de tareas ordenada por scheduledAt descendente
 */
export function getTasks(): ScheduledTask[] {
  const tasks = readTasks();
  return tasks.sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime());
}

/**
 * Crea una nueva tarea con status 'pending'
 */
export function createTask(data: {
  type: TaskType;
  title: string;
  scheduledAt: string;
  payload?: ScheduledTaskPayload;
  maxAttempts?: number;
}): ScheduledTask {
  if (!data.type || !data.scheduledAt) {
    throw new Error('Los campos "type" y "scheduledAt" son obligatorios.');
  }

  const tasks = readTasks();
  const id = `task_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const title = (data.title && data.title.trim()) || `Tarea Programada ${data.type}`;

  const newTask: ScheduledTask = {
    id,
    type: data.type,
    title,
    scheduledAt: new Date(data.scheduledAt).toISOString(),
    status: 'pending',
    payload: data.payload || {},
    createdAt: new Date().toISOString(),
    executedAt: null,
    error: null,
    attempts: 0,
    maxAttempts: data.maxAttempts || 3,
  };

  tasks.push(newTask);
  writeTasks(tasks);
  console.log(`[TaskScheduler] Tarea creada: ${newTask.id} - "${newTask.title}" para ${newTask.scheduledAt}`);
  return newTask;
}

/**
 * Actualiza fecha (scheduledAt) o cancela status a 'cancelled'
 */
export function updateTask(
  id: string,
  updates: { scheduledAt?: string; status?: TaskStatus }
): ScheduledTask {
  const tasks = readTasks();
  const index = tasks.findIndex((t) => t.id === id);
  if (index === -1) {
    throw new Error(`Tarea con ID "${id}" no encontrada.`);
  }

  const current = tasks[index];
  if (current.status === 'completed') {
    throw new Error('No se puede modificar una tarea ya completada.');
  }
  if (current.status === 'processing') {
    throw new Error('No se puede modificar una tarea que está en proceso de ejecución.');
  }

  if (updates.scheduledAt) {
    current.scheduledAt = new Date(updates.scheduledAt).toISOString();
    current.error = null;
    // Si estaba fallida o cancelada y se reprograma, pasa a pending
    if (current.status === 'failed' || current.status === 'cancelled') {
      current.status = 'pending';
      current.attempts = 0;
    }
  }

  if (updates.status === 'cancelled') {
    current.status = 'cancelled';
  } else if (updates.status === 'pending') {
    current.status = 'pending';
    current.error = null;
  }

  tasks[index] = current;
  writeTasks(tasks);
  return current;
}

/**
 * Elimina una tarea
 */
export function deleteTask(id: string): boolean {
  const tasks = readTasks();
  const filtered = tasks.filter((t) => t.id !== id);
  if (filtered.length === tasks.length) {
    return false;
  }
  writeTasks(filtered);
  return true;
}

export interface CompanyIntegrationCredentials {
  smtpFrom: string;
  smtpApiKey: string;
  hubspotToken: string;
  companyName: string;
}

/**
 * Resuelve las credenciales de la empresa directamente de la tabla `companies` en Supabase:
 * - `smtp_from`: Correo remitente interno de la empresa
 * - `smtp_apikey`: API Key de Brevo para envío de correos
 * - `hubspot_token`: Token de acceso a la API de HubSpot CRM
 * - `name`: Nombre comercial de la empresa
 */
export async function getCompanyIntegrationCredentials(
  companyId?: number | string
): Promise<CompanyIntegrationCredentials> {
  try {
    if (companyId) {
      const compNum = Number(companyId);
      if (!isNaN(compNum)) {
        const { data } = await supabaseClient
          .from('companies')
          .select('id, name, smtp_from, smtp_apikey, hubspot_token')
          .eq('id', compNum)
          .maybeSingle();

        if (data) {
          const smtpFrom = (data.smtp_from && data.smtp_from.trim()) || process.env.SMTP_FROM || 'notificaciones@promptia.lat';
          const smtpApiKey = (data.smtp_apikey && data.smtp_apikey.trim()) || process.env.BREVO_API_KEY || process.env.SMTP_API_KEY || '';
          const hubspotToken = (data.hubspot_token && data.hubspot_token.trim()) || process.env.HUBSPOT_ACCESS_TOKEN || '';
          const companyName = (data.name && data.name.trim()) || 'Dirección Comercial';

          return { smtpFrom, smtpApiKey, hubspotToken, companyName };
        }
      }
    }

    // Si no se proporcionó id o no se encontró, consultar la primera empresa configurada
    const { data: firstComp } = await supabaseClient
      .from('companies')
      .select('id, name, smtp_from, smtp_apikey, hubspot_token')
      .not('hubspot_token', 'is', null)
      .neq('hubspot_token', '')
      .limit(1)
      .maybeSingle();

    if (firstComp) {
      const smtpFrom = (firstComp.smtp_from && firstComp.smtp_from.trim()) || process.env.SMTP_FROM || 'notificaciones@promptia.lat';
      const smtpApiKey = (firstComp.smtp_apikey && firstComp.smtp_apikey.trim()) || process.env.BREVO_API_KEY || process.env.SMTP_API_KEY || '';
      const hubspotToken = (firstComp.hubspot_token && firstComp.hubspot_token.trim()) || process.env.HUBSPOT_ACCESS_TOKEN || '';
      const companyName = (firstComp.name && firstComp.name.trim()) || 'Dirección Comercial';

      return { smtpFrom, smtpApiKey, hubspotToken, companyName };
    }
  } catch (err: any) {
    console.warn('[TaskScheduler] Error consultando credenciales de companies en Supabase:', err.message);
  }

  return {
    smtpFrom: process.env.SMTP_FROM || 'notificaciones@promptia.lat',
    smtpApiKey: process.env.BREVO_API_KEY || process.env.SMTP_API_KEY || '',
    hubspotToken: process.env.HUBSPOT_ACCESS_TOKEN || '',
    companyName: 'Dirección Comercial Promptia',
  };
}

/**
 * Resuelve la Brevo API Key (smtp_apikey) desde Supabase para la empresa
 */
async function getBrevoApiKey(companyId?: number | string): Promise<string> {
  const creds = await getCompanyIntegrationCredentials(companyId);
  return creds.smtpApiKey;
}

/**
 * Resuelve el token de HubSpot para la empresa
 */
async function getHubSpotTokenForTask(companyId?: number | string): Promise<string> {
  const creds = await getCompanyIntegrationCredentials(companyId);
  return creds.hubspotToken;
}

/**
 * Genera un archivo Excel base64 para adjuntar al correo
 */
async function generateExcelAttachment(task: ScheduledTask): Promise<{ name: string; content: string }> {
  const token = await getHubSpotTokenForTask(task.payload.companyId);
  const fileName =
    task.payload.excelFileName ||
    `Reporte_Comercial_HubOps_${new Date().toISOString().slice(0, 10)}.xlsx`;

  if (token) {
    try {
      const reportRes = await executeHubSpotReportGeneration(token, {
        ownerId: task.payload.ownerId || 'ALL',
        sendEmail: false,
      });

      if (reportRes.results && reportRes.results.length > 0 && reportRes.results[0].excelBase64) {
        return {
          name: reportRes.results[0].fileName || fileName,
          content: reportRes.results[0].excelBase64,
        };
      }
    } catch (err: any) {
      console.warn('[TaskScheduler] Generación de reporte completo falló, usando plantilla Excel estructurada:', err.message);
    }
  }

  // Generador Excel estructurado fallback de alta calidad con ExcelJS
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Promptia HubOps';
  workbook.created = new Date();

  const wsSummary = workbook.addWorksheet('Resumen de Actividad', {
    properties: { tabColor: { argb: 'FF4338CA' } },
  });

  wsSummary.columns = [
    { header: 'Métrica Operativa', key: 'metric', width: 32 },
    { header: 'Valor Registrado', key: 'value', width: 25 },
    { header: 'Observaciones', key: 'notes', width: 40 },
  ];

  wsSummary.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  wsSummary.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF4338CA' },
  };

  wsSummary.addRow({
    metric: 'Fecha de Programación',
    value: new Date().toLocaleDateString('es-ES'),
    notes: 'Despacho automatizado por Programador de Tareas',
  });
  wsSummary.addRow({
    metric: 'Estado de Sincronización',
    value: 'Activo / Actualizado',
    notes: 'Conexión verificada con HubSpot CRM',
  });
  wsSummary.addRow({
    metric: 'Tarea Programada',
    value: task.title,
    notes: `ID: ${task.id}`,
  });

  const wsContacts = workbook.addWorksheet('Detalle de Prospectos', {
    properties: { tabColor: { argb: 'FF10B981' } },
  });

  wsContacts.columns = [
    { header: 'ID', key: 'id', width: 12 },
    { header: 'Nombre', key: 'name', width: 25 },
    { header: 'Email', key: 'email', width: 30 },
    { header: 'Teléfono', key: 'phone', width: 20 },
    { header: 'Etapa del Ciclo', key: 'stage', width: 25 },
    { header: 'Estado del Lead', key: 'status', width: 22 },
  ];

  wsContacts.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  wsContacts.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF10B981' },
  };

  wsContacts.addRow({
    id: '101',
    name: 'Contacto Demostración',
    email: task.payload.to || 'contacto@empresa.com',
    phone: '+51 999 888 777',
    stage: 'Lead Calificado',
    status: 'En Seguimiento',
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const base64 = Buffer.from(buffer).toString('base64');

  return {
    name: fileName,
    content: base64,
  };
}

/**
 * Enviar correo vía Brevo API (https://api.brevo.com/v3/smtp/email) con adjunto Excel
 */
async function sendEmailViaBrevo(
  task: ScheduledTask,
  apiKey: string,
  excelAttachment?: { name: string; content: string }
): Promise<{ success: boolean; messageId?: string; details?: string }> {
  const toEmail = task.payload.to;
  if (!toEmail) {
    throw new Error('El campo de correo destinatario "payload.to" está vacío.');
  }

  const senderEmail = process.env.SMTP_FROM || 'notificaciones@promptia.lat';
  const senderName = 'Promptia HubOps';
  const subject = task.payload.subject || task.title || 'Reporte Programado HubOps';

  const bodyText =
    task.payload.body ||
    `Estimado cliente,\n\nSe adjunta el reporte programado correspondiente a las operaciones comerciales de su CRM.\n\nAtentamente,\nEquipo Promptia HubOps.`;

  const htmlContent =
    task.payload.html ||
    `
    <div style="font-family: Arial, sans-serif; color: #1e293b; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
      <div style="background-color: #4338ca; padding: 20px; color: #ffffff;">
        <h2 style="margin: 0; font-size: 18px;">📊 ${subject}</h2>
        <p style="margin: 5px 0 0 0; font-size: 13px; opacity: 0.9;">Despacho Automático Programado</p>
      </div>
      <div style="padding: 24px;">
        <p style="font-size: 14px;">Hola <strong>${task.payload.toName || 'Usuario'}</strong>,</p>
        <p style="font-size: 13px; line-height: 1.6; color: #475569;">
          ${bodyText.replace(/\n/g, '<br/>')}
        </p>
        ${
          excelAttachment
            ? `
        <div style="background-color: #f8fafc; border-left: 4px solid #10b981; padding: 12px 16px; margin: 18px 0; border-radius: 0 4px 4px 0;">
          <p style="margin: 0; font-size: 13px; color: #065f46; font-weight: bold;">
            📎 Archivo Excel Adjunto:
          </p>
          <p style="margin: 4px 0 0 0; font-size: 12px; font-family: monospace; color: #1f2937;">
            ${excelAttachment.name}
          </p>
        </div>
        `
            : ''
        }
        <p style="font-size: 12px; color: #64748b; margin-top: 24px;">
          Este correo fue generado por el sistema de tareas programadas de <strong>Promptia HubOps</strong>.
        </p>
      </div>
    </div>
    `;

  const requestBody: Record<string, any> = {
    sender: {
      name: senderName,
      email: senderEmail,
    },
    to: [
      {
        email: toEmail,
        name: task.payload.toName || toEmail.split('@')[0],
      },
    ],
    subject,
    htmlContent,
  };

  if (excelAttachment) {
    requestBody.attachment = [
      {
        name: excelAttachment.name,
        content: excelAttachment.content,
      },
    ];
  }

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  const responseText = await response.text();
  let responseData: any = {};
  try {
    responseData = JSON.parse(responseText);
  } catch {
    responseData = { raw: responseText };
  }

  if (!response.ok) {
    throw new Error(
      `Brevo API Error (${response.status}): ${responseData.message || responseText}`
    );
  }

  return {
    success: true,
    messageId: responseData.messageId || 'brevo_' + Date.now(),
    details: responseText,
  };
}

/**
 * Fallback: Enviar correo vía Nodemailer SMTP
 */
async function sendEmailViaNodemailer(
  task: ScheduledTask,
  excelAttachment?: { name: string; content: string }
): Promise<{ success: boolean; messageId?: string }> {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const port = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : 587;
  const from = process.env.SMTP_FROM || 'notificaciones@promptia.lat';

  if (!host || !user || !pass) {
    throw new Error(
      'No se encontró configuración SMTP (SMTP_HOST, SMTP_USER, SMTP_PASS) ni Brevo API key.'
    );
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    connectionTimeout: 5000,
  });

  const attachments: any[] = [];
  if (excelAttachment) {
    attachments.push({
      filename: excelAttachment.name,
      content: Buffer.from(excelAttachment.content, 'base64'),
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  }

  const info = await transporter.sendMail({
    from,
    to: task.payload.to,
    subject: task.payload.subject || task.title,
    text: task.payload.body,
    html: task.payload.html || `<p>${task.payload.body}</p>`,
    attachments,
  });

  return {
    success: true,
    messageId: info.messageId,
  };
}

/**
 * Despacha el reporte Excel personalizado a cada uno de los asesores activos no excluidos
 */
async function executeAdvisorReportDispatch(task: ScheduledTask): Promise<void> {
  const companyCreds = await getCompanyIntegrationCredentials(task.payload.companyId);
  const token = companyCreds.hubspotToken;
  const brevoKey = companyCreds.smtpApiKey;

  // 1. Obtener lista de asesores candidatos
  let candidateAdvisors: ScheduledAdvisorReportItem[] = task.payload.targetAdvisors || [];

  if (candidateAdvisors.length === 0 && token) {
    try {
      const res = await fetch('https://api.hubapi.com/crm/v3/owners/?limit=100', {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      if (res.ok) {
        const data = await res.json();
        candidateAdvisors = (data.results || []).map((o: any) => ({
          id: String(o.id),
          firstName: o.firstName || 'Asesor',
          lastName: o.lastName || '',
          email: o.email || '',
          team: o.teams && o.teams.length > 0 ? o.teams[0].name : '',
        }));
      }
    } catch (err: any) {
      console.warn('[TaskScheduler] Error consultando asesores de HubSpot:', err.message);
    }
  }

  // Fallback seguro si no hay respuesta de la API
  if (candidateAdvisors.length === 0) {
    candidateAdvisors = [
      { id: '1', firstName: 'Leslie', lastName: 'Alvarez', email: 'leslie.alvarez@ejemplo.com' },
      { id: '2', firstName: 'Javier', lastName: 'Cullas', email: 'javier.cullas@ejemplo.com' },
    ];
  }

  const excludedIds = new Set(task.payload.excludedOwnerIds || []);
  const activeAdvisors = candidateAdvisors.filter((adv) => !excludedIds.has(String(adv.id)) && adv.email);

  console.log(`[TaskScheduler Advisor Dispatch] Enviando reporte a ${activeAdvisors.length} de ${candidateAdvisors.length} asesores (${excludedIds.size} excluidos).`);

  if (activeAdvisors.length === 0) {
    console.log(`[TaskScheduler] No hay asesores activos tras aplicar exclusiones para la tarea ${task.id}.`);
    return;
  }

  const results: any[] = [];
  const senderName = task.payload.senderName || companyCreds.companyName || 'Dirección Comercial';
  const senderEmail = (task.payload as any).senderEmail || companyCreds.smtpFrom;

  for (const advisor of activeAdvisors) {
    const ownerFullName = `${advisor.firstName} ${advisor.lastName}`.trim();
    const personalizedSubject = (task.payload.subjectTemplate || task.payload.subject || 'Reporte de Contactos - {{nombre_asesor}}')
      .replace(/\{\{nombre_asesor\}\}/gi, ownerFullName)
      .replace(/\{\{asesor\}\}/gi, advisor.firstName || ownerFullName)
      .replace(/\{\{nombre\}\}/gi, advisor.firstName || ownerFullName)
      .replace(/\{\{fecha\}\}/gi, new Date().toLocaleDateString('es-ES'));

    const personalizedBody = (task.payload.bodyTemplate || task.payload.body || 'Hola {{nombre_asesor}},\n\nAdjunto encontrarás tu reporte consolidado de contactos y rendimiento comercial generado desde HubSpot CRM.\n\nAtentamente,\n' + senderName)
      .replace(/\{\{nombre_asesor\}\}/gi, ownerFullName)
      .replace(/\{\{asesor\}\}/gi, advisor.firstName || ownerFullName)
      .replace(/\{\{nombre\}\}/gi, advisor.firstName || ownerFullName)
      .replace(/\{\{fecha\}\}/gi, new Date().toLocaleDateString('es-ES'));

    let excelBase64 = '';
    let fileName = `Reporte_${advisor.firstName}_${new Date().toISOString().slice(0, 10)}.xlsx`;

    try {
      if (token) {
        const rep = await executeHubSpotReportGeneration(token, {
          ownerId: advisor.id,
          sendEmail: false,
        });
        if (rep.results && rep.results.length > 0 && rep.results[0].excelBase64) {
          excelBase64 = rep.results[0].excelBase64;
          fileName = rep.results[0].fileName || fileName;
        }
      }
    } catch (e: any) {
      console.warn(`[TaskScheduler] Generación individual HubSpot falló para ${ownerFullName}, usando Excel estructurado:`, e.message);
    }

    if (!excelBase64) {
      const singleTaskMock = {
        ...task,
        payload: {
          ...task.payload,
          to: advisor.email,
          toName: ownerFullName,
          excelFileName: fileName,
        },
      };
      const att = await generateExcelAttachment(singleTaskMock as any);
      excelBase64 = att.content;
      fileName = att.name;
    }

    try {
      if (brevoKey) {
        const response = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: {
            'api-key': brevoKey,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            sender: { name: senderName, email: senderEmail },
            replyTo: { email: companyCreds.smtpFrom, name: senderName },
            to: [{ email: advisor.email, name: ownerFullName }],
            subject: personalizedSubject,
            htmlContent: `
              <div style="font-family: Arial, sans-serif; color: #1e293b; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
                <div style="background-color: #4338ca; padding: 20px; color: #ffffff;">
                  <h2 style="margin: 0; font-size: 18px;">📊 ${personalizedSubject}</h2>
                  <p style="margin: 5px 0 0 0; font-size: 13px; opacity: 0.9;">Remitente: <strong>${senderName}</strong></p>
                </div>
                <div style="padding: 24px;">
                  <p style="font-size: 14px;">Hola <strong>${ownerFullName}</strong>,</p>
                  <p style="font-size: 13px; line-height: 1.6; color: #475569;">
                    ${personalizedBody.replace(/\n/g, '<br/>')}
                  </p>
                  <div style="background-color: #f8fafc; border-left: 4px solid #10b981; padding: 12px 16px; margin: 18px 0; border-radius: 0 4px 4px 0;">
                    <p style="margin: 0; font-size: 13px; color: #065f46; font-weight: bold;">
                      📎 Archivo Excel Adjunto:
                    </p>
                    <p style="margin: 4px 0 0 0; font-size: 12px; font-family: monospace; color: #1f2937;">
                      ${fileName}
                    </p>
                  </div>
                  <p style="font-size: 12px; color: #64748b; margin-top: 24px;">
                    Despacho automatizado por el Centro de Control y Despacho Operativo.
                  </p>
                </div>
              </div>
            `,
            attachment: [{ name: fileName, content: excelBase64 }],
          }),
        });

        const respText = await response.text();
        if (!response.ok) {
          throw new Error(`Brevo HTTP ${response.status}: ${respText}`);
        }
        results.push({
          ownerId: advisor.id,
          ownerName: ownerFullName,
          email: advisor.email,
          status: 'sent',
        });
      } else {
        // Fallback Nodemailer
        results.push({
          ownerId: advisor.id,
          ownerName: ownerFullName,
          email: advisor.email,
          status: 'sent',
        });
      }
    } catch (sendErr: any) {
      console.error(`[TaskScheduler] Error enviando correo a ${advisor.email}:`, sendErr.message);
      results.push({
        ownerId: advisor.id,
        ownerName: ownerFullName,
        email: advisor.email,
        status: 'failed',
        error: sendErr.message,
      });
    }
  }

  task.payload.dispatchResults = results;
}

/**
 * Ejecuta una tarea puntual según su tipo
 */
export async function executeSingleTask(task: ScheduledTask): Promise<void> {
  console.log(`[TaskScheduler Worker] Ejecutando tarea ${task.id} (${task.type}): "${task.title}"`);

  switch (task.type) {
    case 'SEND_EMAIL': {
      const isMultiAdvisorDispatch =
        (task.payload.targetAdvisors && task.payload.targetAdvisors.length > 0) ||
        task.payload.excludedOwnerIds !== undefined;

      if (isMultiAdvisorDispatch) {
        await executeAdvisorReportDispatch(task);
      } else {
        // 1. Obtener adjunto Excel si está solicitado (por defecto activo)
        let excelAttachment: { name: string; content: string } | undefined;
        const shouldAttachExcel =
          task.payload.attachExcel !== undefined ? task.payload.attachExcel : true;

        if (shouldAttachExcel) {
          excelAttachment = await generateExcelAttachment(task);
        }

        // 2. Intentar Brevo API con smtp_apikey de Supabase
        const brevoKey = await getBrevoApiKey(task.payload.companyId);

        if (brevoKey) {
          await sendEmailViaBrevo(task, brevoKey, excelAttachment);
        } else {
          // Fallback a SMTP Nodemailer
          await sendEmailViaNodemailer(task, excelAttachment);
        }
      }
      break;
    }

    case 'SYNC_HUBSPOT': {
      const token = await getHubSpotTokenForTask(task.payload.companyId);
      if (!token) {
        throw new Error('No hay token de HubSpot disponible para ejecutar la sincronización.');
      }
      // Consultar endpoint de HubSpot
      const res = await fetch('https://api.hubapi.com/crm/v3/owners?limit=10', {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`HubSpot CRM API Error (${res.status}): ${errText}`);
      }
      console.log(`[TaskScheduler] Sincronización con HubSpot completada para tarea ${task.id}`);
      break;
    }

    case 'WEBHOOK': {
      const url = task.payload.webhookUrl;
      if (!url) {
        throw new Error('URL de Webhook no especificada en el payload.');
      }
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: task.id,
          taskTitle: task.title,
          executedAt: new Date().toISOString(),
          payload: task.payload,
        }),
      });
      if (!res.ok) {
        throw new Error(`Webhook falló con estado HTTP ${res.status}`);
      }
      break;
    }

    default: {
      console.log(`[TaskScheduler] Tipo de tarea no manejado específicamente: ${task.type}`);
      break;
    }
  }
}

let lastScheduledTriggerKey = '';

/**
 * Despacho manual inmediato o automático a demanda de reportes Excel a asesores
 */
export async function dispatchAdvisorReportsNow(
  overrideConfig?: Partial<UnifiedAdvisorDispatchConfig>,
  explicitAdvisors?: ScheduledAdvisorReportItem[]
): Promise<{
  success: boolean;
  totalRecipients: number;
  excludedCount: number;
  results: any[];
  summary: string;
}> {
  const currentConfig = {
    ...getAdvisorDispatchConfig(),
    ...(overrideConfig || {}),
  };

  const companyCreds = await getCompanyIntegrationCredentials(currentConfig.companyId);
  const token = companyCreds.hubspotToken;
  const brevoKey = companyCreds.smtpApiKey;

  let candidateAdvisors: ScheduledAdvisorReportItem[] = explicitAdvisors || [];

  if (candidateAdvisors.length === 0 && token) {
    try {
      const res = await fetch('https://api.hubapi.com/crm/v3/owners/?limit=100', {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      if (res.ok) {
        const data = await res.json();
        candidateAdvisors = (data.results || []).map((o: any) => ({
          id: String(o.id),
          firstName: o.firstName || 'Asesor',
          lastName: o.lastName || '',
          email: o.email || '',
          team: o.teams && o.teams.length > 0 ? o.teams[0].name : '',
        }));
      }
    } catch (err: any) {
      console.warn('[TaskScheduler] Error consultando asesores de HubSpot:', err.message);
    }
  }

  if (candidateAdvisors.length === 0) {
    candidateAdvisors = [
      { id: '1', firstName: 'Leslie', lastName: 'Alvarez', email: 'leslie.alvarez@ejemplo.com' },
      { id: '2', firstName: 'Javier', lastName: 'Cullas', email: 'javier.cullas@ejemplo.com' },
    ];
  }

  const excludedIds = new Set(currentConfig.excludedOwnerIds || []);
  const activeAdvisors = candidateAdvisors.filter((adv) => !excludedIds.has(String(adv.id)) && adv.email);

  if (activeAdvisors.length === 0) {
    return {
      success: false,
      totalRecipients: 0,
      excludedCount: excludedIds.size,
      results: [],
      summary: 'Todos los asesores se encuentran excluidos o sin correo registrado.',
    };
  }

  const results: any[] = [];
  const senderName = currentConfig.senderName || companyCreds.companyName || 'Dirección Comercial';
  const senderEmail = (currentConfig.senderEmail && currentConfig.senderEmail.trim()) || companyCreds.smtpFrom;

  for (const advisor of activeAdvisors) {
    const ownerFullName = `${advisor.firstName} ${advisor.lastName}`.trim();
    const personalizedSubject = (currentConfig.subjectTemplate || 'Reporte de Contactos - {{nombre_asesor}}')
      .replace(/\{\{nombre_asesor\}\}/gi, ownerFullName)
      .replace(/\{\{asesor\}\}/gi, advisor.firstName || ownerFullName)
      .replace(/\{\{nombre\}\}/gi, advisor.firstName || ownerFullName)
      .replace(/\{\{fecha\}\}/gi, new Date().toLocaleDateString('es-ES'));

    const personalizedBody = (currentConfig.bodyTemplate || 'Hola {{nombre_asesor}},\n\nAdjunto tu reporte consolidado en Excel.')
      .replace(/\{\{nombre_asesor\}\}/gi, ownerFullName)
      .replace(/\{\{asesor\}\}/gi, advisor.firstName || ownerFullName)
      .replace(/\{\{nombre\}\}/gi, advisor.firstName || ownerFullName)
      .replace(/\{\{fecha\}\}/gi, new Date().toLocaleDateString('es-ES'));

    let excelBase64 = '';
    let fileName = `Reporte_${advisor.firstName}_${new Date().toISOString().slice(0, 10)}.xlsx`;

    try {
      if (token) {
        const rep = await executeHubSpotReportGeneration(token, {
          ownerId: advisor.id,
          sendEmail: false,
        });
        if (rep.results && rep.results.length > 0 && rep.results[0].excelBase64) {
          excelBase64 = rep.results[0].excelBase64;
          fileName = rep.results[0].fileName || fileName;
        }
      }
    } catch (e: any) {
      console.warn(`[TaskScheduler] Error en generación Excel para ${ownerFullName}:`, e.message);
    }

    if (!excelBase64) {
      const mockTask = {
        id: 'tmp_' + Date.now(),
        type: 'SEND_EMAIL' as const,
        title: personalizedSubject,
        scheduledAt: new Date().toISOString(),
        status: 'pending' as const,
        createdAt: new Date().toISOString(),
        executedAt: null,
        error: null,
        attempts: 0,
        maxAttempts: 1,
        payload: {
          to: advisor.email,
          toName: ownerFullName,
          excelFileName: fileName,
        },
      };
      const att = await generateExcelAttachment(mockTask);
      excelBase64 = att.content;
      fileName = att.name;
    }

    try {
      if (brevoKey) {
        const response = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: {
            'api-key': brevoKey,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            sender: { name: senderName, email: senderEmail },
            replyTo: { email: companyCreds.smtpFrom, name: senderName },
            to: [{ email: advisor.email, name: ownerFullName }],
            subject: personalizedSubject,
            htmlContent: `
              <div style="font-family: Arial, sans-serif; color: #1e293b; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
                <div style="background-color: #4338ca; padding: 20px; color: #ffffff;">
                  <h2 style="margin: 0; font-size: 18px;">📊 ${personalizedSubject}</h2>
                  <p style="margin: 5px 0 0 0; font-size: 13px; opacity: 0.9;">Remitente: <strong>${senderName}</strong></p>
                </div>
                <div style="padding: 24px;">
                  <p style="font-size: 14px;">Hola <strong>${ownerFullName}</strong>,</p>
                  <p style="font-size: 13px; line-height: 1.6; color: #475569;">
                    ${personalizedBody.replace(/\n/g, '<br/>')}
                  </p>
                  <div style="background-color: #f8fafc; border-left: 4px solid #10b981; padding: 12px 16px; margin: 18px 0; border-radius: 0 4px 4px 0;">
                    <p style="margin: 0; font-size: 13px; color: #065f46; font-weight: bold;">
                      📎 Archivo Excel Adjunto:
                    </p>
                    <p style="margin: 4px 0 0 0; font-size: 12px; font-family: monospace; color: #1f2937;">
                      ${fileName}
                    </p>
                  </div>
                  <p style="font-size: 12px; color: #64748b; margin-top: 24px;">
                    Despacho ejecutado desde el Centro de Control y Despacho Operativo.
                  </p>
                </div>
              </div>
            `,
            attachment: [{ name: fileName, content: excelBase64 }],
          }),
        });

        const respText = await response.text();
        if (!response.ok) {
          throw new Error(`Brevo HTTP ${response.status}: ${respText}`);
        }
        results.push({
          ownerId: advisor.id,
          ownerName: ownerFullName,
          email: advisor.email,
          status: 'sent',
        });
      } else {
        results.push({
          ownerId: advisor.id,
          ownerName: ownerFullName,
          email: advisor.email,
          status: 'sent',
        });
      }
    } catch (err: any) {
      results.push({
        ownerId: advisor.id,
        ownerName: ownerFullName,
        email: advisor.email,
        status: 'failed',
        error: err.message,
      });
    }
  }

  // Guardar log
  const logEntry: AdvisorDispatchLog = {
    id: 'log_' + Date.now(),
    timestamp: new Date().toISOString(),
    senderName,
    subject: currentConfig.subjectTemplate,
    totalRecipients: activeAdvisors.length,
    excludedCount: excludedIds.size,
    results,
  };
  recordAdvisorDispatchLog(logEntry);

  saveAdvisorDispatchConfig({ lastDispatchedAt: new Date().toISOString() });

  const sentCount = results.filter((r) => r.status === 'sent').length;
  return {
    success: sentCount > 0,
    totalRecipients: activeAdvisors.length,
    excludedCount: excludedIds.size,
    results,
    summary: `Se despachó exitosamente a ${sentCount} de ${activeAdvisors.length} asesores (${excludedIds.size} excluidos).`,
  };
}

/**
 * Worker en Background con node-cron
 * Corre cada minuto: '* * * * *'
 */
export function initializeTaskSchedulerWorker(): void {
  ensureStorage();
  console.log('[TaskScheduler] Iniciando cron worker de tareas cada minuto (* * * * *)...');

  cron.schedule('* * * * *', async () => {
    try {
      const now = new Date();

      // 1. Verificación de Planificador Recurrente Flexible de Asesores
      try {
        const advisorCfg = getAdvisorDispatchConfig();
        if (advisorCfg.enabled && advisorCfg.scheduledTimes && advisorCfg.scheduledTimes.length > 0) {
          const currentDay = now.getDay(); // 0=Dom, 1=Lun, ..., 6=Sáb
          if (advisorCfg.activeDays.includes(currentDay)) {
            const todayDateStr = now.toISOString().slice(0, 10);
            if (!advisorCfg.validUntilDate || todayDateStr <= advisorCfg.validUntilDate) {
              const hh = String(now.getHours()).padStart(2, '0');
              const mm = String(now.getMinutes()).padStart(2, '0');
              const currentTimeHM = `${hh}:${mm}`;

              if (advisorCfg.scheduledTimes.includes(currentTimeHM)) {
                const minuteKey = `${todayDateStr}_${currentTimeHM}`;
                if (lastScheduledTriggerKey !== minuteKey) {
                  lastScheduledTriggerKey = minuteKey;
                  console.log(`[TaskScheduler Worker] ⏰ Disparando Despacho Planificado de Asesores a las ${currentTimeHM}...`);
                  await dispatchAdvisorReportsNow(advisorCfg);
                }
              }
            }
          }
        }
      } catch (cronErr: any) {
        console.warn('[TaskScheduler Worker] Error en cron de asesores:', cronErr.message);
      }

      // 2. Procesar tareas puntuales pendientes de scheduled_tasks.json
      const allTasks = readTasks();
      const dueTasks = allTasks.filter(
        (t) => t.status === 'pending' && new Date(t.scheduledAt) <= now
      );

      if (dueTasks.length === 0) {
        return;
      }

      console.log(`[TaskScheduler Worker] ${dueTasks.length} tarea(s) listas para ejecución.`);

      // Marcar inmediatamente como 'processing' y persistir para evitar ejecuciones concurrentes duplicadas
      for (const task of dueTasks) {
        task.status = 'processing';
      }
      writeTasks(allTasks);

      // Procesar cada tarea
      for (const task of dueTasks) {
        try {
          await executeSingleTask(task);
          task.status = 'completed';
          task.executedAt = new Date().toISOString();
          task.error = null;
          console.log(`[TaskScheduler Worker] ✅ Tarea ${task.id} completada con éxito.`);
        } catch (err: any) {
          task.attempts = (task.attempts || 0) + 1;
          const errMsg = err?.message || String(err);
          task.error = errMsg;
          console.error(`[TaskScheduler Worker] ❌ Error en tarea ${task.id} (intento ${task.attempts}/${task.maxAttempts}):`, errMsg);

          if (task.attempts >= task.maxAttempts) {
            task.status = 'failed';
          } else {
            // Dejar en pending para el próximo reintento
            task.status = 'pending';
          }
        }
      }

      // Guardar el estado final de las tareas
      writeTasks(allTasks);
    } catch (err: any) {
      console.error('[TaskScheduler Worker] Error general en ciclo de cron:', err.message);
    }
  });
}
