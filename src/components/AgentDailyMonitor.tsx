import React, { useState, useEffect, useMemo } from 'react';
import {
  BarChart3,
  Users,
  Send,
  Clock,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  TrendingUp,
  MessageSquare,
  Mail,
  Smartphone,
  Sparkles,
  Settings,
  RefreshCw,
  Zap,
  Target,
  UserCheck,
  ChevronRight,
  ShieldCheck,
  Calendar,
  Copy,
  Plus,
  Trash2,
  Globe,
  Sliders,
  Filter,
  Check,
  FileSpreadsheet,
} from 'lucide-react';
import { HubSpotExcelReportPanel } from './HubSpotExcelReportPanel';
import { ScheduledAdvisorReportsModule } from './ScheduledAdvisorReportsModule';
import {
  AgentHealthStatus,
  AgentMetric,
  DispatchLogEntry,
  DispatchMode,
  DispatchSchedule,
  HubSpotOwner,
  NotificationChannel,
  NotificationConfig,
} from '../types';
import { mcpHubspot } from '../services/mcpHubspot';

interface AgentDailyMonitorProps {
  owners: HubSpotOwner[];
}

const HEALTH_BADGES: Record<
  AgentHealthStatus,
  { label: string; bg: string; text: string; border: string; icon: any }
> = {
  on_track: {
    label: 'Al día',
    bg: 'bg-emerald-50',
    text: 'text-emerald-700',
    border: 'border-emerald-200',
    icon: CheckCircle2,
  },
  at_risk: {
    label: 'En riesgo',
    bg: 'bg-amber-50',
    text: 'text-amber-700',
    border: 'border-amber-200',
    icon: AlertTriangle,
  },
  lagging: {
    label: 'Retrasado',
    bg: 'bg-rose-50',
    text: 'text-rose-700',
    border: 'border-rose-200',
    icon: AlertCircle,
  },
};

const DAY_NAMES = [
  { id: 1, short: 'Lun', full: 'Lunes' },
  { id: 2, short: 'Mar', full: 'Martes' },
  { id: 3, short: 'Mié', full: 'Miércoles' },
  { id: 4, short: 'Jue', full: 'Jueves' },
  { id: 5, short: 'Vie', full: 'Viernes' },
  { id: 6, short: 'Sáb', full: 'Sábado' },
  { id: 0, short: 'Dom', full: 'Domingo' },
];

export const AgentDailyMonitor: React.FC<AgentDailyMonitorProps> = ({ owners }) => {
  const [metrics, setMetrics] = useState<AgentMetric[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [dispatchLogs, setDispatchLogs] = useState<DispatchLogEntry[]>([]);
  const [isDispatching, setIsDispatching] = useState<boolean>(false);
  const [dispatchSuccessNotice, setDispatchSuccessNotice] = useState<string | null>(null);
  const [isSavingConfig, setIsSavingConfig] = useState<boolean>(false);
  const [saveSuccessNotice, setSaveSuccessNotice] = useState<string | null>(null);
  const [copiedCron, setCopiedCron] = useState<boolean>(false);

  // Flexible Notification Configuration State
  const [config, setConfig] = useState<NotificationConfig>({
    mode: 'fixed_times',
    scheduledTimes: ['09:00', '13:30', '18:00'],
    activeDays: [1, 2, 3, 4, 5],
    intervalMinutes: 120,
    workHoursStart: '08:30',
    workHoursEnd: '18:30',
    targetAudience: 'all',
    minOverdueFilter: 0,
    channels: ['slack', 'whatsapp'],
    webhookUrl: '',
    customTemplate:
      'Hola {nombre}, llevas {contactados} de {meta} leads gestionados hoy ({tasa} de avance). Tienes {pendientes} leads prioritarios sin actividad reciente. ¡Aceleremos el cierre de cuota!',
    autoDispatchEnabled: true,
    cronExpression: '30 9,13,18 * * 1-5',
    timezone: 'America/Lima',
  });

  // New time input temporary state
  const [newTimeInput, setNewTimeInput] = useState<string>('15:00');

  // Selected agent for live message preview
  const [previewAgentIndex, setPreviewAgentIndex] = useState<number>(0);

  // Load metrics via MCP and saved server config
  const fetchMetrics = async () => {
    setIsLoading(true);
    try {
      const data = await mcpHubspot.hubspot_get_agent_metrics();
      setMetrics(data);
      setDispatchLogs(mcpHubspot.getDispatchLogs());
    } finally {
      setIsLoading(false);
    }
  };

  const loadServerConfig = async () => {
    try {
      const res = await fetch('/api/notifications/config');
      if (res.ok) {
        const data = await res.json();
        if (data.config) {
          setConfig((prev) => ({
            ...prev,
            ...data.config,
          }));
        }
      }
    } catch (_) {}
  };

  useEffect(() => {
    fetchMetrics();
    loadServerConfig();
    const unsub = mcpHubspot.subscribeStatus(() => {
      fetchMetrics();
    });
    return () => unsub();
  }, [owners]);

  // Calculate Operational Totals
  const totals = useMemo(() => {
    const totalAssignedToday = metrics.reduce((acc, m) => acc + m.totalAssignedToday, 0);
    const totalContactedToday = metrics.reduce((acc, m) => acc + m.contactedToday, 0);
    const totalPendingOverdue = metrics.reduce((acc, m) => acc + m.pendingOverdue, 0);
    const totalQuota = metrics.reduce((acc, m) => acc + m.dailyTarget, 0);
    const overallRate = totalQuota > 0 ? Math.round((totalContactedToday / totalQuota) * 100) : 0;
    const onTrackCount = metrics.filter((m) => m.healthStatus === 'on_track').length;
    const atRiskCount = metrics.filter((m) => m.healthStatus === 'at_risk').length;
    const laggingCount = metrics.filter((m) => m.healthStatus === 'lagging').length;

    return {
      totalAssignedToday,
      totalContactedToday,
      totalPendingOverdue,
      totalQuota,
      overallRate,
      onTrackCount,
      atRiskCount,
      laggingCount,
    };
  }, [metrics]);

  // Dynamically compute Cron expression
  const computedCron = useMemo(() => {
    return mcpHubspot.computeCronExpression(config);
  }, [config]);

  // Channel toggling
  const toggleChannel = (channel: NotificationChannel) => {
    setConfig((prev) => {
      const exists = prev.channels.includes(channel);
      let nextChannels: NotificationChannel[];
      if (exists) {
        nextChannels = prev.channels.filter((c) => c !== channel);
        if (nextChannels.length === 0) nextChannels = ['slack'];
      } else {
        nextChannels = [...prev.channels, channel];
      }
      return { ...prev, channels: nextChannels };
    });
  };

  // Toggle Day of Week
  const toggleDay = (dayId: number) => {
    setConfig((prev) => {
      const exists = prev.activeDays.includes(dayId);
      let nextDays: number[];
      if (exists) {
        nextDays = prev.activeDays.filter((d) => d !== dayId);
        if (nextDays.length === 0) nextDays = [1];
      } else {
        nextDays = [...prev.activeDays, dayId];
      }
      return { ...prev, activeDays: nextDays };
    });
  };

  // Add a specific scheduled time
  const handleAddScheduledTime = () => {
    if (!newTimeInput) return;
    if (!config.scheduledTimes.includes(newTimeInput)) {
      const updated = [...config.scheduledTimes, newTimeInput].sort();
      setConfig((prev) => ({ ...prev, scheduledTimes: updated }));
    }
  };

  // Remove scheduled time
  const handleRemoveScheduledTime = (timeToRemove: string) => {
    setConfig((prev) => ({
      ...prev,
      scheduledTimes: prev.scheduledTimes.filter((t) => t !== timeToRemove),
    }));
  };

  // Apply quick schedule presets
  const applyPreset = (presetType: 'open_close' | 'three_cuts' | 'intense' | 'weekdays' | 'all_days') => {
    if (presetType === 'open_close') {
      setConfig((prev) => ({
        ...prev,
        mode: 'fixed_times',
        scheduledTimes: ['09:00', '18:00'],
      }));
    } else if (presetType === 'three_cuts') {
      setConfig((prev) => ({
        ...prev,
        mode: 'fixed_times',
        scheduledTimes: ['09:00', '13:30', '18:00'],
      }));
    } else if (presetType === 'intense') {
      setConfig((prev) => ({
        ...prev,
        mode: 'fixed_times',
        scheduledTimes: ['09:00', '11:30', '14:00', '16:30', '18:30'],
      }));
    } else if (presetType === 'weekdays') {
      setConfig((prev) => ({
        ...prev,
        activeDays: [1, 2, 3, 4, 5],
      }));
    } else if (presetType === 'all_days') {
      setConfig((prev) => ({
        ...prev,
        activeDays: [1, 2, 3, 4, 5, 6, 0],
      }));
    }
  };

  // Preview message compilation for chosen agent
  const compiledPreviewMessage = useMemo(() => {
    if (metrics.length === 0) return '';
    const agent = metrics[previewAgentIndex] || metrics[0];
    return config.customTemplate
      .replace('{nombre}', agent.owner.firstName)
      .replace('{contactados}', agent.contactedToday.toString())
      .replace('{meta}', agent.dailyTarget.toString())
      .replace('{pendientes}', agent.pendingOverdue.toString())
      .replace('{tasa}', `${agent.progressPct}%`);
  }, [metrics, previewAgentIndex, config.customTemplate]);

  // Save config to server
  const handleSaveConfig = async () => {
    setIsSavingConfig(true);
    setSaveSuccessNotice(null);
    try {
      const payload = {
        ...config,
        cronExpression: computedCron,
      };
      const res = await fetch('/api/notifications/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setSaveSuccessNotice('¡Planificador y reglas de despacho guardadas exitosamente!');
        setTimeout(() => setSaveSuccessNotice(null), 5000);
      }
    } catch (_) {
    } finally {
      setIsSavingConfig(false);
    }
  };

  // Manual immediate dispatch trigger (A Demanda)
  const handleImmediateDispatch = async (specificAgent?: AgentMetric) => {
    if (metrics.length === 0) return;
    setIsDispatching(true);
    setDispatchSuccessNotice(null);

    try {
      const targetList = specificAgent ? [specificAgent] : metrics;
      const logs = await mcpHubspot.hubspot_dispatch_notifications(
        targetList,
        { ...config, cronExpression: computedCron },
        specificAgent ? `manual_single_${specificAgent.owner.firstName}` : 'manual_on_demand',
      );
      setDispatchLogs(mcpHubspot.getDispatchLogs());
      setDispatchSuccessNotice(
        `¡Reporte despachado a demanda a ${targetList.length} asesores a través de ${config.channels.join(', ')}!`
      );
      setTimeout(() => setDispatchSuccessNotice(null), 6000);
    } finally {
      setIsDispatching(false);
    }
  };

  // Copy Cron expression
  const handleCopyCron = () => {
    navigator.clipboard.writeText(computedCron);
    setCopiedCron(true);
    setTimeout(() => setCopiedCron(false), 2000);
  };

  return (
    <div className="space-y-6" id="agent-daily-monitor-container">
      {/* Header Banner */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-700 text-xs font-semibold uppercase tracking-wider mb-2">
            <BarChart3 className="w-3.5 h-3.5 text-emerald-600" />
            Caso de Uso 5: Control Operativo
          </div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">
            Reporte de Estatus y Disciplina Diaria por Agente
          </h2>
          <p className="text-sm text-slate-600 mt-0.5">
            Monitoreo en tiempo real del cumplimiento de cuota diaria, detección de leads vencidos (&gt;24h) y despacho automatizado multicanal.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchMetrics}
            disabled={isLoading}
            className="inline-flex items-center gap-1.5 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-300 text-xs font-semibold px-3 py-2 rounded-lg transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            Actualizar Métricas
          </button>
        </div>
      </div>

      {/* KPI Stats Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4" id="kpi-stats-grid">
        {/* Card 1: Leads Contactados Hoy */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              Contactados Hoy
            </span>
            <div className="p-2 rounded-lg bg-emerald-50 text-emerald-600">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-900">{totals.totalContactedToday}</span>
            <span className="text-xs text-slate-500 font-medium">/ {totals.totalQuota} cuota</span>
          </div>
          <div className="mt-2 w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
            <div
              className="bg-emerald-500 h-1.5 rounded-full"
              style={{ width: `${Math.min(100, totals.overallRate)}%` }}
            />
          </div>
          <span className="text-[11px] text-emerald-600 font-semibold mt-1.5 block">
            {totals.overallRate}% cumplimiento general
          </span>
        </div>

        {/* Card 2: Leads Asignados Totales */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              Cartera Asignada
            </span>
            <div className="p-2 rounded-lg bg-indigo-50 text-indigo-600">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-900">{totals.totalAssignedToday}</span>
            <span className="text-xs text-slate-500 font-medium">leads activos</span>
          </div>
          <div className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-500">
            <span className="inline-block w-2 h-2 rounded-full bg-indigo-500" />
            {metrics.length} asesores en rotación activa
          </div>
        </div>

        {/* Card 3: Leads Vencidos / Estancados */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              Leads Estancados (&gt;24h)
            </span>
            <div className="p-2 rounded-lg bg-rose-50 text-rose-600">
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-rose-600">{totals.totalPendingOverdue}</span>
            <span className="text-xs text-slate-500 font-medium">requieren contacto</span>
          </div>
          <div className="mt-2 text-[11px] text-rose-600 font-medium flex items-center gap-1">
            <Clock className="w-3 h-3" />
            Prioridad alta en notificación
          </div>
        </div>

        {/* Card 4: Salud de la Fuerza Comercial */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              Salud del Equipo
            </span>
            <div className="p-2 rounded-lg bg-slate-100 text-slate-700">
              <ShieldCheck className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="text-xs font-bold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
              {totals.onTrackCount} Al día
            </span>
            <span className="text-xs font-bold px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
              {totals.atRiskCount} En riesgo
            </span>
            <span className="text-xs font-bold px-2 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200">
              {totals.laggingCount} Retrasado
            </span>
          </div>
          <div className="mt-3 text-[11px] text-slate-500">
            Basado en avance de cuota diaria y leads estancados (&gt;24h)
          </div>
        </div>
      </div>

      {/* Main Grid: Agent Performance Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden" id="agent-performance-table">
        <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 bg-slate-50/50">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-indigo-600" />
            <h3 className="text-sm font-semibold text-slate-900 uppercase tracking-wide">
              1. Dashboard de Desempeño Individual de Asesores
            </h3>
          </div>
          <span className="text-xs text-slate-500 font-medium">
            Meta diaria operativa: 25 contactos por asesor
          </span>
        </div>

        {/* Guía Explicativa de Salud Operativa */}
        <div className="mx-4 mt-3.5 p-3 bg-gradient-to-r from-slate-50 to-indigo-50/30 border border-slate-200 rounded-lg text-xs">
          <div className="flex items-center gap-1.5 font-semibold text-slate-800 mb-1">
            <ShieldCheck className="w-4 h-4 text-indigo-600" />
            <span>¿Cómo se calcula la «Salud Operativa»?</span>
          </div>
          <p className="text-[11px] text-slate-600 mb-2">
            Mide la gestión del asesor comparando los contactos de hoy contra la meta diaria (25) y auditando leads activos sin gestión por más de 24 horas:
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px]">
            <div className="p-2 bg-white rounded border border-emerald-200 text-emerald-800">
              <span className="font-bold flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-emerald-600" /> Al día:</span>
              <span className="text-[10px] text-slate-600 block mt-0.5">Avance ≥80% y ≤1 lead con &gt;24h sin actividad.</span>
            </div>
            <div className="p-2 bg-white rounded border border-amber-200 text-amber-800">
              <span className="font-bold flex items-center gap-1"><AlertTriangle className="w-3 h-3 text-amber-600" /> En riesgo:</span>
              <span className="text-[10px] text-slate-600 block mt-0.5">Avance 40-79% o entre 2 y 5 leads con &gt;24h sin actividad.</span>
            </div>
            <div className="p-2 bg-white rounded border border-rose-200 text-rose-800">
              <span className="font-bold flex items-center gap-1"><AlertCircle className="w-3 h-3 text-rose-600" /> Retrasado:</span>
              <span className="text-[10px] text-slate-600 block mt-0.5">Avance &lt;40% o más de 5 leads sin actividad en &gt;24h.</span>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
                <th className="py-2.5 px-3">Asesor / Equipo</th>
                <th className="py-2.5 px-3 text-center">Contactados Hoy</th>
                <th className="py-2.5 px-3 text-center">Sin Actividad (&gt;24h)</th>
                <th className="py-2.5 px-3">Cumplimiento Cuota</th>
                <th
                  className="py-2.5 px-3 text-center cursor-help"
                  title="Salud Operativa: Evalúa el ratio de contactos diarios logrados frente a la meta (25) y los leads estancados sin actividad en más de 24 horas."
                >
                  <span className="inline-flex items-center gap-1 justify-center">
                    Salud Operativa
                    <ShieldCheck className="w-3 h-3 text-indigo-500" />
                  </span>
                </th>
                <th className="py-2.5 px-3 text-right">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {metrics.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 px-4 text-center text-slate-500">
                    <Users className="w-10 h-10 mx-auto text-slate-300 mb-2.5" />
                    <p className="font-bold text-slate-700 text-sm">No hay asesores sincronizados</p>
                    <p className="text-xs text-slate-500 max-w-md mx-auto mt-1">
                      Para ver tus asesores y sus métricas reales de HubSpot CRM, ingresa tu <strong>Private App Token</strong> en la pestaña <em>Configuración del Sistema</em>.
                    </p>
                  </td>
                </tr>
              ) : (
                metrics.map((metric, idx) => {
                const health = HEALTH_BADGES[metric.healthStatus];
                const Icon = health.icon;

                return (
                  <tr
                    key={metric.owner.id}
                    className={`hover:bg-slate-50 transition-colors ${
                      previewAgentIndex === idx ? 'bg-indigo-50/30' : ''
                    }`}
                  >
                    {/* Asesor */}
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-2.5">
                        <img
                          src={metric.owner.avatarUrl || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150'}
                          alt={metric.owner.firstName}
                          className="w-8 h-8 rounded-full object-cover border border-slate-200"
                        />
                        <div>
                          <div className="font-semibold text-slate-900">
                            {metric.owner.firstName} {metric.owner.lastName}
                          </div>
                          <div className="text-slate-500 text-[11px]">{metric.owner.email}</div>
                          <div className="text-[10px] text-indigo-600 font-medium mt-0.5">
                            {metric.owner.team}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Contactados */}
                    <td className="py-3 px-3 text-center">
                      <div className="text-sm font-bold text-slate-900">
                        {metric.contactedToday}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        de {metric.dailyTarget} meta
                      </div>
                    </td>

                    {/* Vencidos */}
                    <td className="py-3 px-3 text-center">
                      <span
                        className={`inline-flex items-center gap-1 font-bold text-xs px-2 py-0.5 rounded-full ${
                          metric.pendingOverdue > 2
                            ? 'bg-rose-100 text-rose-700'
                            : metric.pendingOverdue > 0
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-emerald-100 text-emerald-700'
                        }`}
                      >
                        <Clock className="w-3 h-3" />
                        {metric.pendingOverdue}
                      </span>
                    </td>

                    {/* Cumplimiento Bar */}
                    <td className="py-3 px-3 min-w-[130px]">
                      <div className="flex justify-between text-[11px] mb-1 font-semibold">
                        <span className="text-slate-700">{metric.progressPct}%</span>
                        <span className="text-slate-400">{metric.lastActivityTime}</span>
                      </div>
                      <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                        <div
                          className={`h-2 rounded-full ${
                            metric.progressPct >= 80
                              ? 'bg-emerald-500'
                              : metric.progressPct >= 50
                              ? 'bg-amber-500'
                              : 'bg-rose-500'
                          }`}
                          style={{ width: `${Math.min(100, metric.progressPct)}%` }}
                        />
                      </div>
                    </td>

                    {/* Salud Badge */}
                    <td className="py-3 px-3 text-center">
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold border ${health.bg} ${health.text} ${health.border}`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        {health.label}
                      </span>
                    </td>

                    {/* Botón Preview e Individual */}
                    <td className="py-3 px-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => setPreviewAgentIndex(idx)}
                          title="Previsualizar mensaje de este asesor"
                          className={`px-2 py-1 text-[11px] font-semibold rounded-md border transition-colors cursor-pointer ${
                            previewAgentIndex === idx
                              ? 'bg-indigo-600 text-white border-indigo-600'
                              : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                          }`}
                        >
                          Vista
                        </button>
                        <button
                          onClick={() => handleImmediateDispatch(metric)}
                          title="Despachar notificación individual a este asesor (A demanda)"
                          className="p-1 text-slate-600 hover:text-emerald-700 hover:bg-emerald-50 rounded border border-slate-200 transition-colors cursor-pointer"
                        >
                          <Zap className="w-3.5 h-3.5" />
                        </button>
                        <a
                          href="#hubspot-excel-reporter-module"
                          title={`Generar reporte Excel (.xlsx) para ${metric.owner.firstName}`}
                          className="p-1 text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50 rounded border border-emerald-200 transition-colors cursor-pointer inline-flex items-center"
                        >
                          <FileSpreadsheet className="w-3.5 h-3.5" />
                        </a>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          </table>
        </div>
      </div>

      {/* Programador de Despacho de Reportes Excel a Asesores */}
      <ScheduledAdvisorReportsModule owners={owners} />

      {/* HubSpot CRM Automated Excel (.xlsx) Report Generator & Email Distribution */}
      <HubSpotExcelReportPanel owners={owners} />

      {/* Dispatch History & Delivery Logs */}
      {dispatchLogs.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs" id="dispatch-logs-panel">
          <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-indigo-600" />
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide">
                Historial de Despachos Recientes a la Fuerza de Ventas
              </h3>
            </div>
            <span className="text-[11px] text-slate-500 font-medium">
              {dispatchLogs.length} notificaciones entregadas
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-56 overflow-y-auto">
            {(dispatchLogs || []).map((log) => (
              <div
                key={log.id}
                className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between text-[11px] mb-1">
                    <span className="font-semibold text-slate-900">{log.agentName}</span>
                    <span className="font-mono text-slate-400">{log.timestamp}</span>
                  </div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <span className="uppercase text-[9px] font-bold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800">
                      {log.channel}
                    </span>
                    <span className="text-[10px] text-emerald-600 font-semibold flex items-center gap-0.5">
                      <CheckCircle2 className="w-3 h-3" /> Entregado
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-600 line-clamp-2 italic">
                    "{log.messageSnippet}"
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
