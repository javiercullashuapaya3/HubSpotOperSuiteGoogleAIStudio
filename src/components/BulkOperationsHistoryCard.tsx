import React, { useState, useEffect, useMemo } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Clock,
  User,
  Calendar,
  Search,
  Database,
  Layers,
  History,
  RefreshCw,
  ShieldCheck,
  AlertCircle,
  Check,
} from 'lucide-react';
import { BulkUpdateJob } from '../types/bulkHistory';
import { bulkHistoryService } from '../services/bulkHistoryService';

interface BulkOperationsHistoryCardProps {
  currentJobId?: string;
  onClose?: () => void;
  isEmbeddedInResults?: boolean;
}

export const BulkOperationsHistoryCard: React.FC<BulkOperationsHistoryCardProps> = ({
  currentJobId,
  isEmbeddedInResults = false,
}) => {
  const [historyList, setHistoryList] = useState<BulkUpdateJob[]>(() => bulkHistoryService.getAll());
  const [expandedJobId, setExpandedJobId] = useState<string | null>(currentJobId || null);
  const [isRetryingSync, setIsRetryingSync] = useState<string | null>(null);
  const [isSyncingAll, setIsSyncingAll] = useState(false);

  // Supabase diagnostics
  const [supabaseHealth, setSupabaseHealth] = useState<{
    tableExists: boolean;
    rlsBlocked: boolean;
    message: string;
    jobsCount: number;
  } | null>(null);

  // Filters for previous executions
  const [searchQuery, setSearchQuery] = useState('');
  const [filterUser, setFilterUser] = useState('ALL');
  const [filterMode, setFilterMode] = useState('ALL');
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [filterDate, setFilterDate] = useState('ALL');

  const checkConnection = async () => {
    const health = await bulkHistoryService.testSupabaseConnection();
    setSupabaseHealth(health);
  };

  useEffect(() => {
    checkConnection();
    // Attempt to load synced history from Supabase if table is live
    bulkHistoryService.fetchFromSupabase().then((items) => {
      if (items && items.length > 0) {
        setHistoryList(items);
      }
    });
  }, []);

  const refreshList = async () => {
    await checkConnection();
    const local = bulkHistoryService.getAll();
    setHistoryList(local);
    const remote = await bulkHistoryService.fetchFromSupabase();
    if (remote && remote.length > 0) {
      setHistoryList(remote);
    }
  };

  const handleRetryJob = async (jobId: string) => {
    setIsRetryingSync(jobId);
    try {
      await bulkHistoryService.retrySyncJob(jobId);
      setHistoryList(bulkHistoryService.getAll());
      await checkConnection();
    } finally {
      setIsRetryingSync(null);
    }
  };

  const handleSyncAllPending = async () => {
    setIsSyncingAll(true);
    try {
      await bulkHistoryService.syncAllPending();
      setHistoryList(bulkHistoryService.getAll());
      await checkConnection();
    } finally {
      setIsSyncingAll(false);
    }
  };

  const pendingCount = useMemo(() => {
    return historyList.filter((j) => j.supabaseSyncStatus !== 'synced').length;
  }, [historyList]);

  // Distinct users for dropdown filter
  const distinctUsers = useMemo(() => {
    const users = new Set<string>();
    historyList.forEach((j) => {
      if (j.executedByUsername) users.add(j.executedByUsername);
    });
    return Array.from(users);
  }, [historyList]);

  // Filtered operations
  const filteredHistory = useMemo(() => {
    return historyList.filter((job) => {
      // Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchUser = job.executedByUsername.toLowerCase().includes(q);
        const matchClient = String(job.clientId).includes(q);
        const matchJobId = job.jobUuid.toLowerCase().includes(q) || job.id.toLowerCase().includes(q);
        const matchChanges = job.appliedChanges.some(
          (c) => c.label.toLowerCase().includes(q) || c.value.toLowerCase().includes(q),
        );
        const matchFilters = job.filterCriteria.some(
          (f) => f.label.toLowerCase().includes(q) || f.value.toLowerCase().includes(q),
        );
        if (!matchUser && !matchClient && !matchJobId && !matchChanges && !matchFilters) return false;
      }

      // User
      if (filterUser !== 'ALL' && job.executedByUsername !== filterUser) {
        return false;
      }

      // Mode
      if (filterMode !== 'ALL' && job.executionMode !== filterMode) {
        return false;
      }

      // Status
      if (filterStatus !== 'ALL' && job.status !== filterStatus) {
        return false;
      }

      // Date
      if (filterDate !== 'ALL') {
        const jobDate = new Date(job.startedAt).getTime();
        const now = Date.now();
        if (filterDate === 'today') {
          const startOfToday = new Date().setHours(0, 0, 0, 0);
          if (jobDate < startOfToday) return false;
        } else if (filterDate === 'last_7d') {
          if (now - jobDate > 7 * 24 * 3600 * 1000) return false;
        } else if (filterDate === 'last_30d') {
          if (now - jobDate > 30 * 24 * 3600 * 1000) return false;
        }
      }

      return true;
    });
  }, [historyList, searchQuery, filterUser, filterMode, filterStatus, filterDate]);

  const formatDate = (isoStr: string) => {
    try {
      const d = new Date(isoStr);
      return d.toLocaleDateString('es-ES', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return isoStr;
    }
  };

  return (
    <div className={`bg-white dark:bg-[#1E293B] rounded-xl border border-[#E2E8F0] dark:border-[#334155] shadow-xs overflow-hidden ${isEmbeddedInResults ? 'mt-4' : ''}`}>
      {/* Top Header */}
      <div className="p-4 bg-[#F8FAFC] dark:bg-[#0F172A] border-b border-[#E2E8F0] dark:border-[#334155] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-[#E8F7FD] dark:bg-[#21B6EA]/15 border border-[#21B6EA]/40 text-[#0369A1] dark:text-[#21B6EA]">
            <History className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-bold text-[#0B0F19] dark:text-white uppercase tracking-wide">
              Historial de Operaciones Masivas &amp; Auditoría
            </h3>
            <p className="text-[11px] text-slate-600 dark:text-slate-300">
              Registro cronológico y trazabilidad de cambios en leads de HubSpot CRM.
            </p>
          </div>
        </div>

        {/* View Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={refreshList}
            className="px-3 py-1.5 rounded-lg bg-white dark:bg-[#1E293B] hover:bg-[#F4F7FA] dark:hover:bg-[#334155] text-[#0B0F19] dark:text-white border border-[#E2E8F0] dark:border-[#334155] text-xs font-medium transition-colors cursor-pointer inline-flex items-center gap-1.5"
            title="Refrescar historial"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Actualizar ({historyList.length})</span>
          </button>
        </div>
      </div>

      <div className="p-4 space-y-4">
          {/* Connected status badge if operational */}
          {supabaseHealth && !supabaseHealth.rlsBlocked && supabaseHealth.tableExists && (
            <div className="px-3 py-2 rounded-lg bg-[#E8F7FD] dark:bg-[#21B6EA]/15 border border-[#21B6EA]/40 text-[#0B0F19] dark:text-white text-[11px] flex items-center justify-between">
              <div className="flex items-center gap-2 font-medium">
                <span className="w-2 h-2 rounded-full bg-[#21B6EA]"></span>
                <span>
                  Sincronización en la nube activa ({supabaseHealth.jobsCount} registros guardados)
                </span>
              </div>
              {pendingCount > 0 && (
                <button
                  onClick={handleSyncAllPending}
                  disabled={isSyncingAll}
                  className="px-2.5 py-0.5 rounded bg-[#0B0F19] hover:bg-[#1E293B] text-white dark:bg-[#21B6EA] dark:hover:bg-[#38C4F3] dark:text-[#0B0F19] text-[10px] font-semibold cursor-pointer inline-flex items-center gap-1"
                >
                  <RefreshCw className={`w-2.5 h-2.5 ${isSyncingAll ? 'animate-spin' : ''}`} />
                  <span>Sincronizar {pendingCount} pendientes</span>
                </button>
              )}
            </div>
          )}

          {/* Filter Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5 bg-[#F8FAFC] dark:bg-[#0F172A] p-3 rounded-lg border border-[#E2E8F0] dark:border-[#334155] text-xs">
            {/* Search Input */}
            <div className="relative">
              <label className="block text-[10px] font-bold text-[#0B0F19] dark:text-slate-200 uppercase mb-1">
                Buscar por palabra clave
              </label>
              <div className="relative">
                <input
                  type="text"
                  placeholder="Usuario, campo, valor..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full text-xs bg-white dark:bg-[#0B0F19] border border-[#CBD5E1] dark:border-[#334155] rounded-md pl-7 pr-2 py-1.5 text-[#0B0F19] dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#21B6EA]"
                />
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2 top-2" />
              </div>
            </div>

            {/* Filter by User */}
            <div>
              <label className="block text-[10px] font-bold text-[#0B0F19] dark:text-slate-200 uppercase mb-1">
                Usuario de Sesión
              </label>
              <select
                value={filterUser}
                onChange={(e) => setFilterUser(e.target.value)}
                className="w-full text-xs bg-white dark:bg-[#0B0F19] border border-[#CBD5E1] dark:border-[#334155] rounded-md px-2 py-1.5 text-[#0B0F19] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#21B6EA]"
              >
                <option value="ALL">Todos los Usuarios</option>
                {distinctUsers.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </div>

            {/* Filter by Date */}
            <div>
              <label className="block text-[10px] font-bold text-[#0B0F19] dark:text-slate-200 uppercase mb-1">
                Fecha de Ejecución
              </label>
              <select
                value={filterDate}
                onChange={(e) => setFilterDate(e.target.value)}
                className="w-full text-xs bg-white dark:bg-[#0B0F19] border border-[#CBD5E1] dark:border-[#334155] rounded-md px-2 py-1.5 text-[#0B0F19] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#21B6EA]"
              >
                <option value="ALL">Cualquier Fecha</option>
                <option value="today">Hoy</option>
                <option value="last_7d">Últimos 7 días</option>
                <option value="last_30d">Últimos 30 días</option>
              </select>
            </div>

            {/* Filter by Execution Mode */}
            <div>
              <label className="block text-[10px] font-bold text-[#0B0F19] dark:text-slate-200 uppercase mb-1">
                Modo de Envío
              </label>
              <select
                value={filterMode}
                onChange={(e) => setFilterMode(e.target.value)}
                className="w-full text-xs bg-white dark:bg-[#0B0F19] border border-[#CBD5E1] dark:border-[#334155] rounded-md px-2 py-1.5 text-[#0B0F19] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#21B6EA]"
              >
                <option value="ALL">Todos los Modos</option>
                <option value="lote">Sincronización en Lote (lote)</option>
                <option value="individual">Sincronización Individual (individual)</option>
              </select>
            </div>

            {/* Filter by Status */}
            <div>
              <label className="block text-[10px] font-bold text-[#0B0F19] dark:text-slate-200 uppercase mb-1">
                Estado
              </label>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="w-full text-xs bg-white dark:bg-[#0B0F19] border border-[#CBD5E1] dark:border-[#334155] rounded-md px-2 py-1.5 text-[#0B0F19] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#21B6EA]"
              >
                <option value="ALL">Todos los Estados</option>
                <option value="completado">Completado sin errores</option>
                <option value="parcialmente_fallido">Con advertencias / errores parciales</option>
                <option value="fallido">Fallido</option>
              </select>
            </div>
          </div>

          {/* Results List */}
          {historyList.length === 0 ? (
            <div className="py-12 px-4 text-center rounded-xl border border-dashed border-[#E2E8F0] dark:border-[#334155] bg-[#F8FAFC] dark:bg-[#0F172A] space-y-2">
              <div className="w-10 h-10 mx-auto rounded-full bg-[#E8F7FD] dark:bg-[#21B6EA]/15 border border-[#21B6EA]/40 flex items-center justify-center text-[#0369A1] dark:text-[#21B6EA]">
                <History className="w-5 h-5" />
              </div>
              <h4 className="text-xs font-bold text-[#0B0F19] dark:text-white uppercase tracking-wide">
                No hay operaciones registradas aún
              </h4>
              <p className="text-[11px] text-slate-600 dark:text-slate-300 max-w-md mx-auto leading-relaxed">
                Cada vez que ejecutes una actualización masiva o individual en el CRM de HubSpot, se registrará aquí en tiempo real con trazabilidad completa de cambios.
              </p>
            </div>
          ) : filteredHistory.length === 0 ? (
            <div className="py-8 text-center text-slate-600 dark:text-slate-300 text-xs">
              No se encontraron actualizaciones masivas que coincidan con los filtros seleccionados.
            </div>
          ) : (
            <div className="space-y-3">
              {filteredHistory.map((job) => {
                const isExpanded = expandedJobId === job.id;
                const isRecent = job.id === currentJobId;

                return (
                  <div
                    key={job.id}
                    className={`rounded-xl border transition-all ${
                      isRecent
                        ? 'border-[#21B6EA] bg-[#EBF8FD]/70 dark:bg-[#21B6EA]/10 shadow-xs'
                        : isExpanded
                        ? 'border-[#0B0F19]/40 dark:border-[#475569] bg-[#F8FAFC] dark:bg-[#0F172A] shadow-xs'
                        : 'border-[#E2E8F0] dark:border-[#334155] bg-white dark:bg-[#1E293B] hover:border-[#0B0F19]/30 dark:hover:border-[#21B6EA]/50'
                    }`}
                  >
                    {/* Header Row */}
                    <div
                      onClick={() => setExpandedJobId(isExpanded ? null : job.id)}
                      className="p-3.5 flex flex-col md:flex-row md:items-center justify-between gap-3 cursor-pointer select-none"
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={`mt-0.5 p-1.5 rounded-lg shrink-0 ${
                            job.status === 'completado'
                              ? 'bg-[#E8F7FD] dark:bg-[#21B6EA]/15 text-[#0369A1] dark:text-[#21B6EA]'
                              : 'bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-200'
                          }`}
                        >
                          {job.status === 'completado' ? (
                            <CheckCircle2 className="w-4 h-4" />
                          ) : (
                            <AlertTriangle className="w-4 h-4" />
                          )}
                        </div>

                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-xs text-[#0B0F19] dark:text-white tabular-nums">
                              {job.totalTargetRecords} Leads Modificados
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                                job.executionMode === 'lote'
                                  ? 'bg-[#F4F7FA] dark:bg-[#0F172A] text-[#0B0F19] dark:text-white border-[#CBD5E1] dark:border-[#475569]'
                                  : 'bg-[#E8F7FD] dark:bg-[#21B6EA]/15 text-[#0369A1] dark:text-[#21B6EA] border-[#21B6EA]/40'
                              }`}
                            >
                              {job.executionMode === 'lote'
                                ? `Lote (${job.batchCount} bloques)`
                                : 'Individual'}
                            </span>

                            {/* Sync Status Badge */}
                            {job.supabaseSyncStatus === 'synced' ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#E8F7FD] dark:bg-[#21B6EA]/15 text-[#0369A1] dark:text-[#21B6EA] border border-[#21B6EA]/40 flex items-center gap-1">
                                <Database className="w-2.5 h-2.5" />
                                <span>Sincronizado</span>
                              </span>
                            ) : job.supabaseSyncStatus === 'rls_blocked' ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#F4F7FA] dark:bg-[#0F172A] text-[#0B0F19] dark:text-slate-200 border border-[#E2E8F0] dark:border-[#334155] flex items-center gap-1">
                                <ShieldCheck className="w-2.5 h-2.5 text-[#0369A1] dark:text-[#21B6EA]" />
                                <span>Guardado local</span>
                              </span>
                            ) : job.supabaseSyncStatus === 'failed' ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-700 flex items-center gap-1">
                                <AlertCircle className="w-2.5 h-2.5 text-amber-600 dark:text-amber-400" />
                                <span>Pendiente de respaldo</span>
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#F4F7FA] dark:bg-[#0F172A] text-[#0B0F19] dark:text-white border border-[#E2E8F0] dark:border-[#475569]">
                                Sincronizando...
                              </span>
                            )}

                            {isRecent && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#21B6EA] text-[#0B0F19]">
                                Recién Ejecutado
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-3 text-[11px] text-slate-600 dark:text-slate-300 mt-1 flex-wrap tabular-nums">
                            <span className="flex items-center gap-1">
                              <User className="w-3 h-3 text-slate-500 dark:text-slate-400" />
                              <strong className="text-[#0B0F19] dark:text-white">{job.executedByUsername}</strong>
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="flex items-center gap-1">
                              <Calendar className="w-3 h-3 text-slate-500 dark:text-slate-400" />
                              {formatDate(job.startedAt)}
                            </span>
                            {job.durationMs && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="flex items-center gap-1">
                                  <Clock className="w-3 h-3 text-slate-500 dark:text-slate-400" />
                                  {(job.durationMs / 1000).toFixed(1)}s
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="text-right tabular-nums">
                          <div className="text-xs font-semibold text-[#0369A1] dark:text-[#21B6EA] flex items-center gap-1 justify-end">
                            <Check className="w-3.5 h-3.5" />
                            <span>{job.successfulRecords} sincronizados</span>
                          </div>
                          {job.failedRecords > 0 && (
                            <div className="text-[11px] font-medium text-rose-600 dark:text-rose-400">
                              {job.failedRecords} fallidos
                            </div>
                          )}
                        </div>

                        {/* Retry Sync Button if not synced */}
                        {job.supabaseSyncStatus !== 'synced' && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRetryJob(job.id);
                            }}
                            disabled={isRetryingSync === job.id}
                            className="px-2 py-1 rounded bg-[#0B0F19] hover:bg-[#1E293B] text-white dark:bg-[#21B6EA] dark:hover:bg-[#38C4F3] dark:text-[#0B0F19] text-[10px] font-semibold cursor-pointer inline-flex items-center gap-1 shrink-0"
                            title="Reintentar guardar este registro en Supabase"
                          >
                            <RefreshCw className={`w-3 h-3 ${isRetryingSync === job.id ? 'animate-spin' : ''}`} />
                            <span>Reintentar</span>
                          </button>
                        )}

                        <div className="p-1 rounded-md text-slate-500 dark:text-slate-300 hover:text-[#0B0F19] dark:hover:text-white">
                          {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </div>
                      </div>
                    </div>

                    {/* Collapsible Details */}
                    {isExpanded && (
                      <div className="px-4 pb-4 pt-1 border-t border-[#E2E8F0] dark:border-[#334155] space-y-3 bg-white dark:bg-[#1E293B] rounded-b-xl">
                        {/* Supabase error notice if failed */}
                        {job.supabaseError && (
                          <div className="p-2.5 rounded bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-700 text-rose-800 dark:text-rose-200 text-xs flex items-start gap-2">
                            <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                            <div>
                              <strong className="block text-[11px]">Detalle del estado en Supabase:</strong>
                              <p className="text-[11px] font-mono mt-0.5">{job.supabaseError}</p>
                            </div>
                          </div>
                        )}

                        {/* Criterios y Cambios */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs pt-2">
                          {/* Cambios Aplicados */}
                          <div className="p-3 bg-[#F8FAFC] dark:bg-[#0F172A] rounded-lg border border-[#E2E8F0] dark:border-[#334155]">
                            <span className="text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wide block mb-1.5">
                              Valores modificados en HubSpot:
                            </span>
                            <div className="space-y-1">
                              {(job.appliedChanges || []).map((chg, i) => (
                                <div key={i} className="flex justify-between items-center text-[11px]">
                                  <span className="text-slate-600 dark:text-slate-300 font-medium">{chg.label}:</span>
                                  <span
                                    className={`font-semibold px-2 py-0.5 rounded text-[10px] ${
                                      chg.isClear
                                        ? 'bg-amber-100 dark:bg-amber-950/70 text-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-700'
                                        : 'bg-[#E8F7FD] dark:bg-[#21B6EA]/15 text-[#0369A1] dark:text-[#21B6EA] border border-[#21B6EA]/40'
                                    }`}
                                  >
                                    {chg.value}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* Criterios de Selección */}
                          <div className="p-3 bg-[#F8FAFC] dark:bg-[#0F172A] rounded-lg border border-[#E2E8F0] dark:border-[#334155]">
                            <span className="text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wide block mb-1.5">
                              Filtros de selección aplicados:
                            </span>
                            {job.filterCriteria && job.filterCriteria.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {(job.filterCriteria || []).map((crit, i) => (
                                  <span
                                    key={i}
                                    className="inline-flex items-center gap-1 bg-white dark:bg-[#1E293B] px-2 py-0.5 rounded border border-[#E2E8F0] dark:border-[#334155] text-[10px] text-[#0B0F19] dark:text-white"
                                  >
                                    <span className="text-slate-600 dark:text-slate-300">{crit.label}:</span>
                                    <strong className="text-[#0369A1] dark:text-[#21B6EA]">{crit.value}</strong>
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <p className="text-[11px] text-slate-600 dark:text-slate-300 italic">
                                Selección manual sobre lista de contactos.
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Metadata Bar */}
                        <div className="p-2.5 bg-[#F4F7FA] dark:bg-[#0B0F19] rounded-lg text-[10px] font-medium text-slate-600 dark:text-slate-300 flex flex-wrap items-center justify-between gap-2 border border-[#E2E8F0] dark:border-[#334155]">
                          <div>
                            <span className="text-slate-500 dark:text-slate-400">Identificador:</span>{' '}
                            <strong className="text-[#0B0F19] dark:text-white font-mono">{job.jobUuid}</strong>
                          </div>
                          <div>
                            <span className="text-slate-500 dark:text-slate-400">Operador:</span>{' '}
                            <strong className="text-[#0B0F19] dark:text-white">{job.executedByUsername}</strong>
                          </div>
                          <div>
                            <span className="text-slate-500 dark:text-slate-400">Estado de sincronización:</span>{' '}
                            <strong className={job.supabaseSyncStatus === 'synced' ? 'text-[#0369A1] dark:text-[#21B6EA]' : 'text-amber-700 dark:text-amber-300'}>
                              {job.supabaseSyncStatus === 'synced' ? 'Sincronizado' : 'Guardado local'}
                            </strong>
                          </div>
                        </div>

                        {/* Detail Items if recorded */}
                        {job.items && job.items.length > 0 && (
                          <div className="border border-[#E2E8F0] dark:border-[#334155] rounded-lg overflow-hidden">
                            <div className="bg-[#F8FAFC] dark:bg-[#0F172A] px-3 py-1.5 text-[10px] font-bold uppercase text-[#0B0F19] dark:text-slate-200 border-b border-[#E2E8F0] dark:border-[#334155]">
                              Muestra de Contactos Afectados ({job.items.length} registrados):
                            </div>
                            <div className="max-h-36 overflow-y-auto divide-y divide-[#E2E8F0] dark:divide-[#334155] text-[11px]">
                              {(job.items || []).map((item) => (
                                <div key={item.id} className="p-2 flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    {item.status === 'exitoso' ? (
                                      <Check className="w-3 h-3 text-[#0369A1] dark:text-[#21B6EA] shrink-0" />
                                    ) : (
                                      <AlertTriangle className="w-3 h-3 text-rose-600 dark:text-rose-400 shrink-0" />
                                    )}
                                    <span className="font-semibold text-[#0B0F19] dark:text-white">{item.recordIdentifier}</span>
                                    <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                                      (ID: {item.recordId})
                                    </span>
                                  </div>
                                  <span
                                    className={`text-[10px] px-2 py-0.5 rounded font-medium border ${
                                      item.status === 'exitoso'
                                        ? 'text-[#0369A1] dark:text-[#21B6EA] bg-[#E8F7FD] dark:bg-[#21B6EA]/15 border-[#21B6EA]/40'
                                        : 'text-rose-700 dark:text-rose-200 bg-rose-50 dark:bg-rose-950/60 border-rose-200 dark:border-rose-700'
                                    }`}
                                  >
                                    {item.status === 'exitoso'
                                      ? `Lote ${item.batchChunkIndex}`
                                      : 'Error al actualizar'}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
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
