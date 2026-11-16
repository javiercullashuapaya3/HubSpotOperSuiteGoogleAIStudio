import React, { useState, useEffect } from 'react';
import {
  CalendarClock,
  Mail,
  FileSpreadsheet,
  Users,
  CheckCircle2,
  Clock,
  AlertCircle,
  XCircle,
  Sparkles,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Loader2,
  Info,
  ShieldCheck,
  Send,
  Calendar,
  Zap,
  Check,
  Plus,
  Trash2,
  Play,
  Pause,
  Server,
  Database,
  ExternalLink,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { HubSpotOwner } from '../types';

interface ScheduledAdvisorReportsModuleProps {
  owners: HubSpotOwner[];
}

export interface UnifiedAdvisorDispatchConfig {
  enabled: boolean;
  activeDays: number[]; // [1, 2, 3, 4, 5] (1=Lun, ..., 0=Dom)
  scheduledTimes: string[]; // ['09:00', '14:00', '18:00']
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

export interface ScheduledTask {
  id: string;
  type: string;
  title: string;
  scheduledAt: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  payload: any;
  createdAt: string;
  executedAt: string | null;
  error: string | null;
  attempts: number;
}

const WEEK_DAYS = [
  { id: 1, label: 'Lunes', short: 'Lun' },
  { id: 2, label: 'Martes', short: 'Mar' },
  { id: 3, label: 'Miércoles', short: 'Mié' },
  { id: 4, label: 'Jueves', short: 'Jue' },
  { id: 5, label: 'Viernes', short: 'Vie' },
  { id: 6, label: 'Sábado', short: 'Sáb' },
  { id: 0, label: 'Domingo', short: 'Dom' },
];

export const ScheduledAdvisorReportsModule: React.FC<ScheduledAdvisorReportsModuleProps> = ({
  owners = [],
}) => {
  const { company } = useAuth();

  // Estados del Planificador Unificado
  const [enabled, setEnabled] = useState<boolean>(true);
  const [activeDays, setActiveDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [scheduledTimes, setScheduledTimes] = useState<string[]>(['09:00', '14:00', '18:00']);
  const [newTimeInput, setNewTimeInput] = useState<string>('09:00');
  const [isPermanent, setIsPermanent] = useState<boolean>(true);
  const [validUntilDate, setValidUntilDate] = useState<string>('');

  // Parámetros de envío (Remitente, Asunto, Mensaje)
  const [senderName, setSenderName] = useState<string>(company?.name || 'Dirección Comercial Promptia');
  const [senderEmail, setSenderEmail] = useState<string>(company?.smtp_from || 'notificaciones@promptia.lat');
  const [subjectTemplate, setSubjectTemplate] = useState<string>(
    'Reporte de Contactos Asignados - {{nombre_asesor}}'
  );
  const [bodyTemplate, setBodyTemplate] = useState<string>(
    'Hola {{nombre_asesor}},\n\nAdjunto encontrarás tu reporte consolidado en Excel con tus contactos asignados y métricas comerciales de HubSpot CRM.\n\nPor favor prioriza tus contactos con más de 24 horas sin actividad reciente para el cumplimiento de meta.\n\nAtentamente,\n{{remitente}}'
  );
  const [excludedOwnerIds, setExcludedOwnerIds] = useState<string[]>([]);
  const [lastDispatchedAt, setLastDispatchedAt] = useState<string | null>(null);

  // Estados de interfaz y ejecución
  const [isEditorOpen, setIsEditorOpen] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isSendingImmediate, setIsSendingImmediate] = useState<boolean>(false);
  const [dispatchLogs, setDispatchLogs] = useState<AdvisorDispatchLog[]>([]);
  const [showVpsInfo, setShowVpsInfo] = useState<boolean>(false);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  // Alerta o notificación
  const [notice, setNotice] = useState<{
    type: 'success' | 'error' | 'info';
    message: string;
  } | null>(null);

  // Cargar configuración existente y logs desde el backend
  const loadPlannerData = async () => {
    try {
      setLoading(true);
      // 1. Configuración del planificador
      const resCfg = await fetch('/api/advisor-dispatch/config');
      if (resCfg.ok) {
        const dataCfg = await resCfg.json();
        if (dataCfg.success && dataCfg.config) {
          const cfg = dataCfg.config;
          setEnabled(cfg.enabled ?? true);
          if (Array.isArray(cfg.activeDays)) setActiveDays(cfg.activeDays);
          if (Array.isArray(cfg.scheduledTimes) && cfg.scheduledTimes.length > 0) {
            setScheduledTimes(cfg.scheduledTimes);
          }
          if (cfg.validUntilDate) {
            setIsPermanent(false);
            setValidUntilDate(cfg.validUntilDate);
          } else {
            setIsPermanent(true);
            setValidUntilDate('');
          }
          if (cfg.senderName) setSenderName(cfg.senderName);
          if (cfg.senderEmail) {
            setSenderEmail(cfg.senderEmail);
          } else if (company?.smtp_from) {
            setSenderEmail(company.smtp_from);
          }
          if (cfg.subjectTemplate) setSubjectTemplate(cfg.subjectTemplate);
          if (cfg.bodyTemplate) setBodyTemplate(cfg.bodyTemplate);
          if (Array.isArray(cfg.excludedOwnerIds)) setExcludedOwnerIds(cfg.excludedOwnerIds);
          if (cfg.lastDispatchedAt) setLastDispatchedAt(cfg.lastDispatchedAt);
        }
      }

      // 2. Logs de despacho
      const resLogs = await fetch('/api/advisor-dispatch/logs');
      if (resLogs.ok) {
        const dataLogs = await resLogs.json();
        if (dataLogs.success && Array.isArray(dataLogs.logs)) {
          setDispatchLogs(dataLogs.logs);
        }
      }
    } catch (err: any) {
      console.warn('Error consultando planificador:', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPlannerData();
    const interval = setInterval(loadPlannerData, 30000);
    return () => clearInterval(interval);
  }, []);

  // Helpers de selección de días
  const toggleDay = (dayId: number) => {
    setActiveDays((prev) =>
      prev.includes(dayId) ? prev.filter((d) => d !== dayId) : [...prev, dayId]
    );
  };

  const setPresetDays = (preset: 'weekdays' | 'all' | 'weekend') => {
    if (preset === 'weekdays') setActiveDays([1, 2, 3, 4, 5]);
    if (preset === 'all') setActiveDays([0, 1, 2, 3, 4, 5, 6]);
    if (preset === 'weekend') setActiveDays([6, 0]);
  };

  // Helpers de horas
  const handleAddTime = () => {
    if (!newTimeInput) return;
    if (!scheduledTimes.includes(newTimeInput)) {
      setScheduledTimes([...scheduledTimes, newTimeInput].sort());
    }
  };

  const handleRemoveTime = (time: string) => {
    if (scheduledTimes.length <= 1) {
      setNotice({
        type: 'info',
        message: 'Debes mantener al menos una hora programada para el despacho.',
      });
      return;
    }
    setScheduledTimes(scheduledTimes.filter((t) => t !== time));
  };

  // Helpers de exclusión de asesores
  const toggleExcludeAdvisor = (ownerId: string) => {
    setExcludedOwnerIds((prev) =>
      prev.includes(ownerId) ? prev.filter((id) => id !== ownerId) : [...prev, ownerId]
    );
  };

  const handleIncludeAll = () => setExcludedOwnerIds([]);
  const handleExcludeAll = () => setExcludedOwnerIds(owners.map((o) => o.id));

  const activeAdvisorsCount = owners.length - excludedOwnerIds.length;

  const getCandidateAdvisors = () =>
    owners.map((o) => ({
      id: o.id,
      firstName: o.firstName,
      lastName: o.lastName,
      email: o.email,
      team: o.team,
    }));

  // Toggle rápido de activar/pausar planificador
  const handleToggleEnable = async () => {
    const nextState = !enabled;
    setEnabled(nextState);
    try {
      const res = await fetch('/api/advisor-dispatch/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: nextState }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error);
      setNotice({
        type: 'info',
        message: nextState
          ? 'El planificador permanente ha sido activado.'
          : 'El planificador ha sido pausado. No se ejecutarán despachos automáticos.',
      });
    } catch (err: any) {
      setEnabled(!nextState);
      setNotice({
        type: 'error',
        message: `Error al cambiar estado: ${err.message}`,
      });
    }
  };

  // Guardar configuración del planificador permanente
  const handleSavePlanner = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (activeDays.length === 0) {
      setNotice({
        type: 'error',
        message: 'Debes seleccionar al menos un día de la semana para el planificador.',
      });
      return;
    }
    if (scheduledTimes.length === 0) {
      setNotice({
        type: 'error',
        message: 'Debes configurar al menos una hora de despacho.',
      });
      return;
    }

    setIsSaving(true);
    setNotice(null);

    try {
      const payload: Partial<UnifiedAdvisorDispatchConfig> = {
        enabled: true,
        activeDays,
        scheduledTimes,
        validUntilDate: isPermanent ? null : validUntilDate || null,
        senderName: senderName.trim() || 'Dirección Comercial Promptia',
        senderEmail: senderEmail.trim() || 'notificaciones@promptia.lat',
        subjectTemplate: subjectTemplate.trim(),
        bodyTemplate: bodyTemplate.trim(),
        excludedOwnerIds,
        companyId: company?.id || 1,
      };

      const res = await fetch('/api/advisor-dispatch/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'No se pudo guardar la configuración del planificador.');
      }

      setEnabled(true);
      setIsEditorOpen(false);
      setNotice({
        type: 'success',
        message: `¡Planificador guardado y activado exitosamente! Despachará automáticamente a las ${scheduledTimes.join(
          ', '
        )} hrs los días seleccionados (${activeDays.length} días/sem)${
          isPermanent ? ' de forma permanente' : ` hasta el ${validUntilDate}`
        }.`,
      });
      loadPlannerData();
    } catch (err: any) {
      setNotice({
        type: 'error',
        message: err.message || 'Error al guardar la configuración del planificador.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Despacho Inmediato Bajo Demanda ("Enviar en este momento")
  const handleSendImmediately = async () => {
    if (activeAdvisorsCount <= 0) {
      setNotice({
        type: 'error',
        message: 'No puedes despachar si todos los asesores están excluidos. Incluye al menos un asesor.',
      });
      return;
    }

    setIsSendingImmediate(true);
    setNotice(null);

    try {
      const candidateAdvisors = getCandidateAdvisors();
      const res = await fetch('/api/advisor-dispatch/send-now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          overrideConfig: {
            companyId: company?.id || 1,
            senderName: senderName.trim() || 'Dirección Comercial Promptia',
            senderEmail: senderEmail.trim() || 'notificaciones@promptia.lat',
            subjectTemplate: subjectTemplate.trim(),
            bodyTemplate: bodyTemplate.trim(),
            excludedOwnerIds,
          },
          advisors: candidateAdvisors,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Fallo en la ejecución del despacho inmediato.');
      }

      setNotice({
        type: 'success',
        message: `¡Despacho inmediato completado! Se generaron y enviaron los reportes Excel con datos de HubSpot CRM a los ${activeAdvisorsCount} asesores activos.`,
      });
      setLastDispatchedAt(new Date().toISOString());
      loadPlannerData();
    } catch (err: any) {
      setNotice({
        type: 'error',
        message: err.message || 'Error al ejecutar despacho inmediato.',
      });
    } finally {
      setIsSendingImmediate(false);
    }
  };

  // Previsualización dinámica del asunto
  const sampleAdvisor = owners[0] || { firstName: 'Leslie', lastName: 'Alvarez' };
  const sampleFullName = `${sampleAdvisor.firstName} ${sampleAdvisor.lastName}`.trim();
  const sampleSubjectPreview = (subjectTemplate || 'Reporte de Contactos')
    .replace(/\{\{nombre_asesor\}\}/gi, sampleFullName)
    .replace(/\{\{asesor\}\}/gi, sampleAdvisor.firstName)
    .replace(/\{\{fecha\}\}/gi, new Date().toLocaleDateString('es-ES'));

  // Nombres de días seleccionados para visualización
  const selectedDayNames = activeDays
    .map((d) => WEEK_DAYS.find((w) => w.id === d)?.short)
    .filter(Boolean)
    .join(', ');

  return (
    <div
      className="bg-white dark:bg-[#1E293B] rounded-xl border border-[#E2E8F0] dark:border-[#334155] shadow-xs p-5 space-y-5 transition-colors"
      id="unified-advisor-reports-planner-section"
    >
      {/* Header Unificado */}
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 pb-4 border-b border-[#E2E8F0] dark:border-[#334155]">
        <div>
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md bg-[#E8F7FD] dark:bg-[#21B6EA]/15 text-[#0369A1] dark:text-[#21B6EA] border border-[#21B6EA]/40 text-xs font-semibold uppercase tracking-wider mb-2">
            <CalendarClock className="w-3.5 h-3.5 text-[#0369A1] dark:text-[#21B6EA]" />
            Planificador Unificado & Automatización Comercial
          </div>
          <h3 className="text-lg font-bold text-[#0B0F19] dark:text-white tracking-tight flex items-center gap-2">
            Planificador Flexible de Despacho de Reportes a Asesores
          </h3>
          <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
            Configura en un solo lugar qué días, a qué horas y hasta cuándo se despacharán automáticamente los
            reportes Excel a cada asesor, con opción de despacho inmediato en cualquier momento.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto justify-start lg:justify-end">
          {/* Botón Refrescar */}
          <button
            onClick={loadPlannerData}
            disabled={loading}
            className="px-2.5 py-1.5 rounded-lg border border-[#CBD5E1] dark:border-[#334155] bg-white dark:bg-[#0F172A] hover:bg-[#F8FAFC] dark:hover:bg-[#334155] text-[#0B0F19] dark:text-slate-100 text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            title="Actualizar datos del planificador"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-[#0369A1] dark:text-[#21B6EA]' : ''}`} />
            <span>Refrescar</span>
          </button>

          {/* Botón ENVIAR EN ESTE MOMENTO (Destacado en el encabezado) */}
          <button
            type="button"
            onClick={handleSendImmediately}
            disabled={isSendingImmediate || owners.length === 0}
            className="px-4 py-2 rounded-lg bg-[#21B6EA] hover:bg-[#38C4F3] active:bg-[#1AA3D4] text-[#0B0F19] text-xs font-bold transition-all flex items-center gap-2 cursor-pointer shadow-xs disabled:opacity-50 whitespace-nowrap shrink-0"
            title="Ejecutar despacho inmediato a todos los asesores activos en este momento"
          >
            {isSendingImmediate ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Despachando ahora...</span>
              </>
            ) : (
              <>
                <Zap className="w-3.5 h-3.5 fill-current" />
                <span>Enviar en este momento</span>
              </>
            )}
          </button>

          {/* Botón Abrir/Cerrar Editor */}
          <button
            type="button"
            onClick={() => setIsEditorOpen(!isEditorOpen)}
            className={`px-3.5 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-xs whitespace-nowrap shrink-0 ${
              isEditorOpen
                ? 'bg-[#F4F7FA] dark:bg-[#0F172A] hover:bg-[#E2E8F0] dark:hover:bg-[#334155] text-[#0B0F19] dark:text-white border border-[#CBD5E1] dark:border-[#475569]'
                : 'bg-[#0B0F19] hover:bg-[#1E293B] text-white dark:bg-[#0F172A] dark:hover:bg-[#334155] dark:border dark:border-[#21B6EA]/45'
            }`}
          >
            <CalendarClock className="w-3.5 h-3.5" />
            <span>{isEditorOpen ? 'Ocultar Planificador' : 'Configurar Planificador'}</span>
          </button>
        </div>
      </div>

      {/* Banner de Aviso/Alerta */}
      {notice && (
        <div
          className={`p-3.5 rounded-xl border text-xs flex items-center justify-between gap-3 animate-in fade-in ${
            notice.type === 'success'
              ? 'bg-[#E8F7FD] dark:bg-[#21B6EA]/15 border-[#21B6EA]/40 text-[#0369A1] dark:text-[#21B6EA]'
              : notice.type === 'error'
              ? 'bg-rose-50 dark:bg-rose-500/15 border-rose-200 dark:border-rose-500/35 text-rose-800 dark:text-rose-200'
              : 'bg-[#EBF8FD] dark:bg-[#0F172A] border-[#BAE6FD] dark:border-[#334155] text-[#0B0F19] dark:text-slate-100'
          }`}
        >
          <div className="flex items-center gap-2">
            {notice.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-[#0369A1] dark:text-[#21B6EA] shrink-0" />
            ) : notice.type === 'error' ? (
              <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
            ) : (
              <Info className="w-4 h-4 text-[#0369A1] dark:text-[#21B6EA] shrink-0" />
            )}
            <span className="font-medium">{notice.message}</span>
          </div>
          <button
            onClick={() => setNotice(null)}
            className="text-slate-500 dark:text-slate-300 hover:text-[#0B0F19] dark:hover:text-white cursor-pointer font-bold"
          >
            ✕
          </button>
        </div>
      )}

      {/* TARJETA DE ESTADO EN VIVO DEL PLANIFICADOR ACTIVO */}
      <div className="p-4 rounded-xl border border-[#E2E8F0] dark:border-[#334155] bg-[#F8FAFC] dark:bg-[#0F172A]">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-[#E2E8F0] dark:border-[#334155]">
          <div className="flex items-center gap-3">
            <div
              className={`w-9 h-9 rounded-lg flex items-center justify-center font-bold shrink-0 ${
                enabled
                  ? 'bg-[#21B6EA] text-[#0B0F19] shadow-xs'
                  : 'bg-slate-200 dark:bg-[#1E293B] text-slate-600 dark:text-slate-300'
              }`}
            >
              {enabled ? <Clock className="w-5 h-5" /> : <Pause className="w-5 h-5" />}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="font-bold text-sm text-[#0B0F19] dark:text-white">
                  {enabled ? 'Planificador Automático en Ejecución' : 'Planificador en Pausa'}
                </h4>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                    enabled
                      ? 'bg-[#E8F7FD] dark:bg-[#21B6EA]/15 text-[#0369A1] dark:text-[#21B6EA] border-[#21B6EA]/40'
                      : 'bg-slate-100 dark:bg-[#1E293B] text-slate-700 dark:text-slate-300 border-slate-300 dark:border-[#475569]'
                  }`}
                >
                  {enabled ? '● Cron Activo' : 'Pausado'}
                </span>
              </div>
              <p className="text-[11px] text-slate-600 dark:text-slate-300">
                {enabled
                  ? 'El motor cron en background verifica cada minuto los horarios configurados.'
                  : 'Las ejecuciones automáticas están suspendidas. Puedes enviar manualmente en cualquier momento.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleToggleEnable}
              className={`px-3 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                enabled
                  ? 'border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/15 hover:bg-amber-100 dark:hover:bg-amber-500/25 text-amber-800 dark:text-amber-300'
                  : 'border-[#21B6EA]/40 bg-[#E8F7FD] dark:bg-[#21B6EA]/15 hover:bg-[#D5EFFA] dark:hover:bg-[#21B6EA]/25 text-[#0369A1] dark:text-[#21B6EA]'
              }`}
            >
              {enabled ? (
                <>
                  <Pause className="w-3.5 h-3.5" />
                  <span>Pausar Planificador</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5" />
                  <span>Activar Planificador</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => setIsEditorOpen(!isEditorOpen)}
              className="px-3 py-1.5 rounded-lg border border-[#CBD5E1] dark:border-[#334155] bg-white dark:bg-[#1E293B] hover:bg-[#F4F7FA] dark:hover:bg-[#334155] text-[#0B0F19] dark:text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <CalendarClock className="w-3.5 h-3.5 text-[#0369A1] dark:text-[#21B6EA]" />
              <span>{isEditorOpen ? 'Cerrar Edición' : 'Editar Reglas'}</span>
            </button>
          </div>
        </div>

        {/* Resumen de Reglas Actuales */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 text-xs">
          <div className="bg-white dark:bg-[#1E293B] p-2.5 rounded-lg border border-[#E2E8F0] dark:border-[#334155]">
            <div className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 mb-0.5">📅 Días Activos</div>
            <div className="font-semibold text-[#0B0F19] dark:text-white truncate">
              {activeDays.length === 7 ? 'Todos los días' : activeDays.length === 5 && !activeDays.includes(0) && !activeDays.includes(6) ? 'Lunes a Viernes' : selectedDayNames || 'Ninguno'}
            </div>
          </div>

          <div className="bg-white dark:bg-[#1E293B] p-2.5 rounded-lg border border-[#E2E8F0] dark:border-[#334155]">
            <div className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 mb-0.5">⏰ Horas de Envío</div>
            <div className="font-semibold text-[#0B0F19] dark:text-white truncate tabular-nums">
              {scheduledTimes.join(', ')} hrs
            </div>
          </div>

          <div className="bg-white dark:bg-[#1E293B] p-2.5 rounded-lg border border-[#E2E8F0] dark:border-[#334155]">
            <div className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 mb-0.5">⏳ Vigencia</div>
            <div className="font-semibold text-[#0B0F19] dark:text-white truncate">
              {isPermanent || !validUntilDate ? 'Permanente (Sin límite)' : `Hasta ${validUntilDate}`}
            </div>
          </div>

          <div className="bg-white dark:bg-[#1E293B] p-2.5 rounded-lg border border-[#E2E8F0] dark:border-[#334155]">
            <div className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 mb-0.5">👥 Destinatarios</div>
            <div className="font-semibold text-[#0369A1] dark:text-[#21B6EA] truncate tabular-nums">
              {activeAdvisorsCount} de {owners.length} asesores
            </div>
          </div>
        </div>
      </div>

      {/* FORMULARIO UNIFICADO DEL PLANIFICADOR */}
      {isEditorOpen && (
        <form
          onSubmit={handleSavePlanner}
          className="bg-[#F8FAFC] dark:bg-[#0F172A] rounded-xl border border-[#CBD5E1] dark:border-[#334155] p-5 space-y-5 animate-in fade-in"
        >
          <div className="flex items-center justify-between pb-3 border-b border-[#E2E8F0] dark:border-[#334155]">
            <div className="flex items-center gap-2">
              <CalendarClock className="w-5 h-5 text-[#0369A1] dark:text-[#21B6EA]" />
              <div>
                <h4 className="text-sm font-bold text-[#0B0F19] dark:text-white">
                  Configuración del Planificador Flexible & Permanente
                </h4>
                <p className="text-[11px] text-slate-600 dark:text-slate-300">
                  Define las reglas periódicas de envío, remitente, asunto y personalización para la fuerza de ventas.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsEditorOpen(false)}
              className="text-slate-500 dark:text-slate-300 hover:text-[#0B0F19] dark:hover:text-white text-xs font-semibold cursor-pointer"
            >
              ✕ Cerrar
            </button>
          </div>

          {/* 1. SECCIÓN DE PLANIFICACIÓN: DÍAS, HORAS Y VIGENCIA */}
          <div className="p-4 bg-white dark:bg-[#1E293B] rounded-xl border border-[#E2E8F0] dark:border-[#334155] space-y-4">
            <div className="flex items-center gap-2 text-xs font-bold text-[#0B0F19] dark:text-white uppercase tracking-wide pb-2 border-b border-[#E2E8F0] dark:border-[#334155]">
              <Clock className="w-4 h-4 text-[#0369A1] dark:text-[#21B6EA]" />
              1. Frecuencia y Horarios de Despacho Automático
            </div>

            {/* Días de la semana */}
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                <label className="block text-xs font-bold text-[#0B0F19] dark:text-slate-200 uppercase">
                  📅 ¿Qué días se ejecutará el envío? *
                </label>
                <div className="flex items-center gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setPresetDays('weekdays')}
                    className="text-[#0369A1] dark:text-[#21B6EA] hover:underline font-semibold cursor-pointer"
                  >
                    Lun a Vie
                  </button>
                  <span className="text-slate-300 dark:text-slate-600">•</span>
                  <button
                    type="button"
                    onClick={() => setPresetDays('all')}
                    className="text-[#0369A1] dark:text-[#21B6EA] hover:underline font-semibold cursor-pointer"
                  >
                    Todos los días
                  </button>
                  <span className="text-slate-300 dark:text-slate-600">•</span>
                  <button
                    type="button"
                    onClick={() => setPresetDays('weekend')}
                    className="text-[#0369A1] dark:text-[#21B6EA] hover:underline font-semibold cursor-pointer"
                  >
                    Fines de semana
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-7 gap-1.5">
                {WEEK_DAYS.map((day) => {
                  const isActive = activeDays.includes(day.id);
                  return (
                    <button
                      key={day.id}
                      type="button"
                      onClick={() => toggleDay(day.id)}
                      className={`py-2 text-center font-bold text-xs rounded-lg border transition-all cursor-pointer ${
                        isActive
                          ? 'bg-[#0B0F19] text-white border-[#0B0F19] dark:bg-[#21B6EA] dark:text-[#0B0F19] dark:border-[#21B6EA] shadow-2xs'
                          : 'bg-[#F8FAFC] dark:bg-[#0F172A] text-slate-600 dark:text-slate-300 border-[#E2E8F0] dark:border-[#334155] hover:bg-[#F4F7FA] dark:hover:bg-[#334155]'
                      }`}
                    >
                      {day.short}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Horas de despacho */}
            <div>
              <label className="block text-xs font-bold text-[#0B0F19] dark:text-slate-200 uppercase mb-1.5">
                ⏰ ¿A qué hora(s) se enviará el reporte? *
              </label>
              <div className="flex flex-wrap items-center gap-1.5 mb-2.5">
                {scheduledTimes.map((time) => (
                  <span
                    key={time}
                    className="inline-flex items-center gap-1.5 bg-[#E8F7FD] dark:bg-[#0F172A] border border-[#BAE6FD] dark:border-[#334155] text-[#0369A1] dark:text-[#21B6EA] font-mono font-bold text-xs px-2.5 py-1 rounded-md tabular-nums"
                  >
                    {time} hrs
                    <button
                      type="button"
                      onClick={() => handleRemoveTime(time)}
                      className="text-slate-500 dark:text-slate-300 hover:text-rose-600 dark:hover:text-rose-400 cursor-pointer text-xs"
                      title="Quitar hora"
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="time"
                  value={newTimeInput}
                  onChange={(e) => setNewTimeInput(e.target.value)}
                  className="bg-[#F8FAFC] dark:bg-[#0B0F19] border border-[#CBD5E1] dark:border-[#334155] rounded-lg px-2.5 py-1.5 text-[#0B0F19] dark:text-white font-mono text-xs focus:outline-none focus:ring-2 focus:ring-[#21B6EA]"
                />
                <button
                  type="button"
                  onClick={handleAddTime}
                  className="inline-flex items-center gap-1 px-3 py-1.5 bg-[#0B0F19] hover:bg-[#1E293B] text-white dark:bg-[#21B6EA] dark:hover:bg-[#38C4F3] dark:text-[#0B0F19] rounded-lg font-semibold text-xs transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Añadir Hora
                </button>
                <div className="flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-300 pl-2">
                  <span>Sugerencias rápidas:</span>
                  {['09:00', '14:00', '18:00'].map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => {
                        if (!scheduledTimes.includes(t)) setScheduledTimes([...scheduledTimes, t].sort());
                      }}
                      className="underline hover:text-[#0369A1] dark:hover:text-[#21B6EA] cursor-pointer tabular-nums"
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Hasta cuándo (Vigencia) */}
            <div className="pt-2 border-t border-[#E2E8F0] dark:border-[#334155]">
              <label className="block text-xs font-bold text-[#0B0F19] dark:text-slate-200 uppercase mb-1.5">
                ⏳ ¿Hasta cuándo estará activo este planificador? *
              </label>
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-[#0B0F19] dark:text-slate-200">
                  <input
                    type="radio"
                    name="duration_type"
                    checked={isPermanent}
                    onChange={() => {
                      setIsPermanent(true);
                      setValidUntilDate('');
                    }}
                    className="accent-[#0B0F19] dark:accent-[#21B6EA]"
                  />
                  <span>Permanente (Sin fecha límite, se ejecuta indefinidamente)</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-[#0B0F19] dark:text-slate-200">
                  <input
                    type="radio"
                    name="duration_type"
                    checked={!isPermanent}
                    onChange={() => setIsPermanent(false)}
                    className="accent-[#0B0F19] dark:accent-[#21B6EA]"
                  />
                  <span>Hasta una fecha específica:</span>
                </label>

                {!isPermanent && (
                  <input
                    type="date"
                    required={!isPermanent}
                    value={validUntilDate}
                    onChange={(e) => setValidUntilDate(e.target.value)}
                    className="bg-[#F8FAFC] dark:bg-[#0B0F19] border border-[#CBD5E1] dark:border-[#334155] rounded-lg px-2.5 py-1 text-[#0B0F19] dark:text-white text-xs font-medium focus:outline-none focus:ring-2 focus:ring-[#21B6EA]"
                  />
                )}
              </div>
            </div>
          </div>

          {/* 2. SECCIÓN DE CONFIGURACIÓN DEL CORREO */}
          <div className="p-4 bg-white dark:bg-[#1E293B] rounded-xl border border-[#E2E8F0] dark:border-[#334155] space-y-4">
            <div className="flex items-center gap-2 text-xs font-bold text-[#0B0F19] dark:text-white uppercase tracking-wide pb-2 border-b border-[#E2E8F0] dark:border-[#334155]">
              <Mail className="w-4 h-4 text-[#0369A1] dark:text-[#21B6EA]" />
              2. Configuración de Remitente, Asunto y Mensaje
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Nombre del Remitente */}
              <div>
                <label className="block text-xs font-bold text-[#0B0F19] dark:text-slate-200 uppercase mb-1">
                  👤 Nombre del Remitente *
                </label>
                <input
                  type="text"
                  required
                  value={senderName}
                  onChange={(e) => setSenderName(e.target.value)}
                  placeholder="Ej. Dirección Comercial"
                  className="w-full text-xs bg-[#F8FAFC] dark:bg-[#0B0F19] border border-[#CBD5E1] dark:border-[#334155] rounded-lg px-3 py-2 text-[#0B0F19] dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-[#21B6EA]"
                />
                <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-1">
                  Nombre que aparecerá en el "De:" del correo.
                </p>
              </div>

              {/* Correo del Remitente */}
              <div>
                <label className="block text-xs font-bold text-[#0B0F19] dark:text-slate-200 uppercase mb-1">
                  ✉️ Correo del Remitente (Brevo / SMTP) *
                </label>
                <input
                  type="email"
                  required
                  value={senderEmail}
                  onChange={(e) => setSenderEmail(e.target.value)}
                  placeholder="notificaciones@promptia.lat"
                  className="w-full text-xs bg-[#F8FAFC] dark:bg-[#0B0F19] border border-[#CBD5E1] dark:border-[#334155] rounded-lg px-3 py-2 text-[#0B0F19] dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-[#21B6EA] font-mono"
                />
                <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-1">
                  Dirección verificada en tu cuenta de Brevo o servidor SMTP.
                </p>
              </div>

              {/* Asunto Parametrizable */}
              <div className="md:col-span-2">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                  <label className="block text-xs font-bold text-[#0B0F19] dark:text-slate-200 uppercase">
                    📝 Asunto del Correo (Parametrizable con Variables) *
                  </label>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-slate-600 dark:text-slate-300">Insertar:</span>
                    <button
                      type="button"
                      onClick={() => setSubjectTemplate((prev) => `${prev} {{nombre_asesor}}`)}
                      className="px-2 py-0.5 rounded bg-[#E8F7FD] dark:bg-[#0F172A] text-[#0369A1] dark:text-[#21B6EA] hover:bg-[#D5EFFA] dark:hover:bg-[#334155] text-[10px] font-mono font-bold border border-[#BAE6FD] dark:border-[#334155] cursor-pointer"
                    >
                      + {'{{nombre_asesor}}'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setSubjectTemplate((prev) => `${prev} {{fecha}}`)}
                      className="px-2 py-0.5 rounded bg-[#E8F7FD] dark:bg-[#0F172A] text-[#0369A1] dark:text-[#21B6EA] hover:bg-[#D5EFFA] dark:hover:bg-[#334155] text-[10px] font-mono font-bold border border-[#BAE6FD] dark:border-[#334155] cursor-pointer"
                    >
                      + {'{{fecha}}'}
                    </button>
                  </div>
                </div>
                <input
                  type="text"
                  required
                  value={subjectTemplate}
                  onChange={(e) => setSubjectTemplate(e.target.value)}
                  placeholder="Ej. Reporte de Contactos Asignados - {{nombre_asesor}}"
                  className="w-full text-xs font-mono bg-[#F8FAFC] dark:bg-[#0B0F19] border border-[#CBD5E1] dark:border-[#334155] rounded-lg px-3 py-2 text-[#0B0F19] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#21B6EA]"
                />
                <div className="mt-1.5 flex items-center gap-2 text-[11px] text-[#0B0F19] dark:text-slate-200 bg-[#EBF8FD] dark:bg-[#0F172A] p-2 rounded border border-[#BAE6FD] dark:border-[#334155]">
                  <Sparkles className="w-3.5 h-3.5 text-[#0369A1] dark:text-[#21B6EA] shrink-0" />
                  <span>
                    Vista previa para <strong>{sampleFullName}</strong>: "{sampleSubjectPreview}"
                  </span>
                </div>
              </div>

              {/* Cuerpo del Mensaje */}
              <div className="md:col-span-2">
                <label className="block text-xs font-bold text-[#0B0F19] dark:text-slate-200 uppercase mb-1">
                  📄 Mensaje / Plantilla del Correo
                </label>
                <textarea
                  rows={3}
                  value={bodyTemplate}
                  onChange={(e) => setBodyTemplate(e.target.value)}
                  placeholder="Hola {{nombre_asesor}}, se adjunta tu reporte..."
                  className="w-full text-xs bg-[#F8FAFC] dark:bg-[#0B0F19] border border-[#CBD5E1] dark:border-[#334155] rounded-lg px-3 py-2 text-[#0B0F19] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#21B6EA] leading-relaxed"
                />
                <div className="mt-1 text-[11px] text-[#0369A1] dark:text-[#21B6EA] flex items-center gap-1 font-medium">
                  <FileSpreadsheet className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    El archivo Excel (.xlsx) con los datos y métricas comerciales de HubSpot CRM se adjunta de forma automatizada a cada correo.
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* 3. SECCIÓN DE ASESORES DESTINATARIOS */}
          <div className="p-4 bg-white dark:bg-[#1E293B] rounded-xl border border-[#E2E8F0] dark:border-[#334155] space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-[#E2E8F0] dark:border-[#334155]">
              <div>
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-[#0369A1] dark:text-[#21B6EA]" />
                  <span className="text-xs font-bold text-[#0B0F19] dark:text-white uppercase">
                    3. Asesores Destinatarios ({owners.length})
                  </span>
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-300">
                  Haz clic en cualquier asesor para incluirlo o excluirlo del despacho programado.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-[#E8F7FD] dark:bg-[#21B6EA]/15 text-[#0369A1] dark:text-[#21B6EA] border border-[#21B6EA]/40 tabular-nums">
                  {activeAdvisorsCount} incluidos
                </span>
                {excludedOwnerIds.length > 0 && (
                  <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-rose-50 dark:bg-rose-500/15 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-500/35 tabular-nums">
                    {excludedOwnerIds.length} excluidos
                  </span>
                )}
                <div className="flex items-center gap-1 pl-2 border-l border-[#E2E8F0] dark:border-[#334155] text-xs">
                  <button
                    type="button"
                    onClick={handleIncludeAll}
                    className="text-[#0369A1] dark:text-[#21B6EA] hover:underline font-semibold cursor-pointer"
                  >
                    Incluir Todos
                  </button>
                  <span className="text-slate-300 dark:text-slate-600">|</span>
                  <button
                    type="button"
                    onClick={handleExcludeAll}
                    className="text-slate-600 dark:text-slate-300 hover:text-[#0B0F19] dark:hover:text-white font-semibold cursor-pointer"
                  >
                    Excluir Todos
                  </button>
                </div>
              </div>
            </div>

            {/* Grid de Asesores */}
            {owners.length === 0 ? (
              <div className="py-6 text-center text-slate-500 dark:text-slate-400 text-xs">
                No se encontraron asesores de HubSpot CRM.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-60 overflow-y-auto p-1">
                {owners.map((owner) => {
                  const isExcluded = excludedOwnerIds.includes(owner.id);
                  const isIncluded = !isExcluded;
                  const initials = `${owner.firstName?.[0] || ''}${owner.lastName?.[0] || ''}`.toUpperCase() || 'A';

                  return (
                    <div
                      key={owner.id}
                      onClick={() => toggleExcludeAdvisor(owner.id)}
                      className={`p-2.5 rounded-lg border flex items-center justify-between gap-2 cursor-pointer transition-all ${
                        isIncluded
                          ? 'bg-[#F8FAFC] dark:bg-[#0F172A] border-[#E2E8F0] dark:border-[#334155] hover:border-[#21B6EA]'
                          : 'bg-rose-50/40 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/30 opacity-65'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {owner.avatarUrl ? (
                          <img
                            src={owner.avatarUrl}
                            alt={owner.firstName}
                            className="w-7 h-7 rounded-full object-cover border border-[#CBD5E1] dark:border-[#475569] shrink-0"
                          />
                        ) : (
                          <div className="w-7 h-7 rounded-full bg-[#0B0F19] dark:bg-[#21B6EA] text-white dark:text-[#0B0F19] text-[10px] font-bold flex items-center justify-center shrink-0">
                            {initials}
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="font-semibold text-xs text-[#0B0F19] dark:text-white truncate">
                            {owner.firstName} {owner.lastName}
                          </div>
                          <div className="text-[10px] text-slate-600 dark:text-slate-300 truncate">{owner.email}</div>
                        </div>
                      </div>

                      <button
                        type="button"
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 transition-colors ${
                          isIncluded
                            ? 'bg-[#E8F7FD] dark:bg-[#21B6EA]/15 text-[#0369A1] dark:text-[#21B6EA] border-[#21B6EA]/40'
                            : 'bg-rose-50 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-300 dark:border-rose-500/35'
                        }`}
                      >
                        {isIncluded ? 'Incluido' : 'Excluido'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ACCIONES DEL FORMULARIO UNIFICADO */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
            {/* Opción 1: Enviar en este momento */}
            <button
              type="button"
              onClick={handleSendImmediately}
              disabled={isSendingImmediate || isSaving || activeAdvisorsCount === 0}
              className="w-full sm:w-auto px-4 py-2.5 rounded-lg bg-[#21B6EA] hover:bg-[#38C4F3] text-[#0B0F19] text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 shadow-xs"
              title="Disparar inmediatamente el despacho a todos los asesores sin esperar al cron"
            >
              {isSendingImmediate ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Enviando reportes ahora...</span>
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4 fill-current" />
                  <span>Enviar en este momento</span>
                </>
              )}
            </button>

            {/* Opción 2: Cancelar o Guardar Planificador Permanente */}
            <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end">
              <button
                type="button"
                onClick={() => setIsEditorOpen(false)}
                className="px-4 py-2.5 rounded-lg border border-[#CBD5E1] dark:border-[#334155] text-[#0B0F19] dark:text-slate-200 text-xs font-semibold hover:bg-[#F4F7FA] dark:hover:bg-[#334155] transition-colors cursor-pointer"
              >
                Cancelar
              </button>

              <button
                type="submit"
                disabled={isSaving || isSendingImmediate || activeAdvisorsCount === 0}
                className="px-5 py-2.5 rounded-lg bg-[#0B0F19] hover:bg-[#1E293B] text-white dark:bg-[#21B6EA] dark:hover:bg-[#38C4F3] dark:text-[#0B0F19] text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 shadow-xs"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Guardando configuración...</span>
                  </>
                ) : (
                  <>
                    <CalendarClock className="w-4 h-4" />
                    <span>Guardar y Activar Planificador Permanente</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* HISTORIAL DE DESPACHOS Y REGISTRO DE ENTREGAS */}
      <div className="space-y-3 pt-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-[#0369A1] dark:text-[#21B6EA]" />
            <h4 className="text-xs font-bold text-[#0B0F19] dark:text-white uppercase tracking-wide">
              Historial de Despachos Ejecutados ({dispatchLogs.length})
            </h4>
          </div>
          <span className="text-[11px] text-slate-600 dark:text-slate-300">
            Registro automático de envíos inmediatos y cron programados
          </span>
        </div>

        {loading && dispatchLogs.length === 0 ? (
          <div className="py-8 text-center text-slate-500 dark:text-slate-300 text-xs flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-[#0369A1] dark:text-[#21B6EA]" />
            <span>Consultando historial de despachos...</span>
          </div>
        ) : dispatchLogs.length === 0 ? (
          <div className="py-8 px-4 text-center rounded-xl bg-[#F8FAFC] dark:bg-[#0F172A] border border-dashed border-[#CBD5E1] dark:border-[#334155] space-y-2">
            <div className="w-10 h-10 mx-auto rounded-full bg-[#E8F7FD] dark:bg-[#1E293B] border border-[#BAE6FD] dark:border-[#334155] flex items-center justify-center text-[#0369A1] dark:text-[#21B6EA]">
              <CalendarClock className="w-5 h-5" />
            </div>
            <h5 className="text-xs font-bold text-[#0B0F19] dark:text-white uppercase">
              No hay ejecuciones registradas todavía
            </h5>
            <p className="text-[11px] text-slate-600 dark:text-slate-300 max-w-md mx-auto">
              Cuando el cron se ejecute a las horas programadas o hagas clic en "Enviar en este momento",
              los resultados y confirmaciones de entrega se mostrarán aquí.
            </p>
          </div>
        ) : (
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {dispatchLogs.map((log) => {
              const isExpanded = expandedLogId === log.id;
              const dateObj = new Date(log.timestamp);
              const formattedDate = dateObj.toLocaleString('es-ES', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              });

              const sentCount = log.results.filter((r) => r.status === 'sent').length;
              const failedCount = log.results.filter((r) => r.status === 'failed').length;

              return (
                <div
                  key={log.id}
                  className="bg-white dark:bg-[#0F172A] border border-[#E2E8F0] dark:border-[#334155] rounded-lg p-3 text-xs shadow-2xs hover:border-[#21B6EA]/60 transition-all"
                >
                  <div
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 cursor-pointer"
                    onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="w-6 h-6 rounded-full bg-[#E8F7FD] dark:bg-[#21B6EA]/15 text-[#0369A1] dark:text-[#21B6EA] flex items-center justify-center font-bold text-xs shrink-0">
                        ✓
                      </span>
                      <div>
                        <div className="font-semibold text-[#0B0F19] dark:text-white">{log.subject}</div>
                        <div className="text-[11px] text-slate-600 dark:text-slate-300 flex items-center gap-2 mt-0.5">
                          <span>Remitente: {log.senderName}</span>
                          <span>•</span>
                          <span className="tabular-nums">{formattedDate}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 self-end sm:self-auto">
                      <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-[#E8F7FD] dark:bg-[#21B6EA]/15 text-[#0369A1] dark:text-[#21B6EA] border border-[#21B6EA]/40 tabular-nums">
                        {sentCount} enviados
                      </span>
                      {failedCount > 0 && (
                        <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-50 dark:bg-rose-500/15 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-500/35 tabular-nums">
                          {failedCount} fallidos
                        </span>
                      )}
                      <span className="text-slate-500 dark:text-slate-300 hover:text-[#0B0F19] dark:hover:text-white">
                        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </span>
                    </div>
                  </div>

                  {/* Detalle expandido de asesores */}
                  {isExpanded && (
                    <div className="mt-3 pt-3 border-t border-[#E2E8F0] dark:border-[#334155] space-y-1.5 animate-in fade-in">
                      <div className="font-bold text-[11px] text-[#0B0F19] dark:text-slate-200 uppercase">
                        Detalle por asesor destinatario:
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {log.results.map((r, idx) => (
                          <div
                            key={idx}
                            className="bg-[#F8FAFC] dark:bg-[#1E293B] p-2 rounded border border-[#E2E8F0] dark:border-[#334155] flex items-center justify-between text-[11px]"
                          >
                            <div className="min-w-0 pr-2">
                              <span className="font-semibold text-[#0B0F19] dark:text-white block truncate">
                                {r.ownerName}
                              </span>
                              <span className="text-slate-600 dark:text-slate-300 block truncate">{r.email}</span>
                            </div>
                            <span
                              className={`px-1.5 py-0.5 rounded font-bold uppercase text-[9px] shrink-0 ${
                                r.status === 'sent'
                                  ? 'bg-[#E8F7FD] dark:bg-[#21B6EA]/15 text-[#0369A1] dark:text-[#21B6EA]'
                                  : 'bg-rose-100 dark:bg-rose-500/20 text-rose-800 dark:text-rose-300'
                              }`}
                            >
                              {r.status === 'sent' ? 'Entregado' : 'Fallido'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
