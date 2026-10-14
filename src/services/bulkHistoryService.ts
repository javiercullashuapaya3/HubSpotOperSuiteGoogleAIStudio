import { BulkUpdateJob, BulkUpdateJobItem } from '../types/bulkHistory';
import { supabase } from '../supabase';

const STORAGE_KEY = 'hubops_bulk_update_history_v4';
const LEGACY_STORAGE_KEYS = [
  'hubops_bulk_update_history_v1',
  'hubops_bulk_update_history_v2',
  'hubops_bulk_update_history_v3',
];

class BulkHistoryService {
  private history: BulkUpdateJob[] = [];

  constructor() {
    this.cleanLegacyStorage();
    this.loadHistory();
  }

  /**
   * Purges old storage keys and filters out dummy/mock seed jobs.
   */
  private cleanLegacyStorage() {
    try {
      LEGACY_STORAGE_KEYS.forEach((k) => localStorage.removeItem(k));
    } catch {
      // Storage unavailable or disabled
    }
  }

  private isDummyJob(job: any): boolean {
    if (!job) return true;
    const dummyIds = ['job-101', 'job-100', 'job-99'];
    if (dummyIds.includes(String(job.id))) return true;
    if (job.executedByUsername === 'javiercullashuapayagenai@gmail.com' && job.totalTargetRecords === 142) return true;
    if (job.executedByUsername === 'supervisor.ventas@empresa.com') return true;
    if (job.executedByUsername === 'admin.operaciones@empresa.com') return true;
    return false;
  }

  private loadHistory() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          // Strictly remove any dummy mock data
          this.history = parsed.filter((j) => !this.isDummyJob(j));
          this.persist();
          return;
        }
      }
      this.history = [];
    } catch {
      this.history = [];
    }
  }

  private persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.history));
    } catch {
      // Storage quota reached or unavailable
    }
  }

  public getAll(): BulkUpdateJob[] {
    return [...this.history];
  }

  /**
   * Diagnoses connection to Supabase and detects if RLS is blocking operations.
   */
  public async testSupabaseConnection(): Promise<{
    tableExists: boolean;
    rlsBlocked: boolean;
    message: string;
    jobsCount: number;
  }> {
    try {
      // Check if table can be queried
      const { data, count, error: selectErr } = await supabase
        .from('bulk_update_jobs')
        .select('id', { count: 'exact' })
        .limit(1);

      if (selectErr) {
        if (selectErr.code === '42P01') {
          return {
            tableExists: false,
            rlsBlocked: false,
            message: 'La tabla bulk_update_jobs no existe en Supabase.',
            jobsCount: 0,
          };
        }
        if (selectErr.code === '42501') {
          return {
            tableExists: true,
            rlsBlocked: true,
            message: 'Row Level Security (RLS) activo sin políticas para SELECT/INSERT (Error 42501).',
            jobsCount: 0,
          };
        }
        return {
          tableExists: false,
          rlsBlocked: false,
          message: selectErr.message,
          jobsCount: 0,
        };
      }

      const totalCount = count ?? (data ? data.length : 0);

      // Check if any job is currently marked as RLS blocked
      const hasRlsBlockedJob = this.history.some((j) => j.supabaseSyncStatus === 'rls_blocked');

      return {
        tableExists: true,
        rlsBlocked: hasRlsBlockedJob,
        message: hasRlsBlockedJob
          ? 'RLS está bloqueando las inserciones de auditoría (Error 42501).'
          : 'Conexión a Supabase operativa.',
        jobsCount: totalCount,
      };
    } catch (err: any) {
      return {
        tableExists: false,
        rlsBlocked: false,
        message: err.message || 'Error de red con Supabase',
        jobsCount: 0,
      };
    }
  }

  /**
   * Persists a job and its items into Supabase tables bulk_update_jobs and bulk_update_job_items.
   * If RLS or DB error occurs, captures the exact state so the user can inspect and resolve it.
   */
  public async syncToSupabase(job: BulkUpdateJob): Promise<{ success: boolean; error?: string }> {
    const numericClientId = Math.floor(Number(job.clientId)) || 1;

    try {
      const payload: Record<string, any> = {
        client_id: numericClientId,
        executed_by_username: job.executedByUsername || 'Usuario de Sesión',
        executed_by_user_id: job.executedByUserId || null,
        execution_mode: job.executionMode || 'lote',
        status: job.status || 'completado',
        total_target_records: Math.max(0, Number(job.totalTargetRecords) || 0),
        successful_records: Math.max(0, Number(job.successfulRecords) || 0),
        failed_records: Math.max(0, Number(job.failedRecords) || 0),
        batch_count: Math.max(1, Number(job.batchCount) || 1),
        filter_criteria_json: job.filterCriteria || [],
        payload_changes_json: job.appliedChanges || [],
        error_summary: job.errorSummary || null,
        started_at: job.startedAt || new Date().toISOString(),
        finished_at: job.finishedAt || new Date().toISOString(),
        duration_ms: typeof job.durationMs === 'number' ? job.durationMs : null,
      };

      // Only pass job_uuid if it is a valid UUID format to prevent postgres uuid parse error
      if (job.jobUuid && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(job.jobUuid)) {
        payload.job_uuid = job.jobUuid;
      }

      const { data: jobRow, error: jobErr } = await supabase
        .from('bulk_update_jobs')
        .insert(payload)
        .select('id, job_uuid')
        .single();

      if (jobErr) {
        console.error('Error insertando en Supabase bulk_update_jobs:', jobErr);
        if (jobErr.code === '42501') {
          job.supabaseSyncStatus = 'rls_blocked';
          job.supabaseError =
            'Bloqueado por Row Level Security (RLS) en Supabase (código 42501). Se debe deshabilitar RLS o crear la política de INSERT en bulk_update_jobs.';
        } else if (jobErr.code === '42P01') {
          job.supabaseSyncStatus = 'failed';
          job.supabaseError = 'Tabla bulk_update_jobs no existe en Supabase.';
        } else {
          job.supabaseSyncStatus = 'failed';
          job.supabaseError = `${jobErr.code ? `[${jobErr.code}] ` : ''}${jobErr.message}`;
        }
        this.updateJobInHistory(job);
        return { success: false, error: job.supabaseError };
      }

      if (jobRow?.id) {
        const supabaseDbId = Number(jobRow.id);
        job.id = String(supabaseDbId);
        if (jobRow.job_uuid) {
          job.jobUuid = jobRow.job_uuid;
        }
        job.supabaseSyncStatus = 'synced';
        job.supabaseError = undefined;

        // Insert items if available
        if (job.items && job.items.length > 0) {
          const itemsToInsert = job.items.map((item) => ({
            job_id: supabaseDbId,
            client_id: numericClientId,
            record_id: String(item.recordId),
            record_identifier: item.recordIdentifier || '',
            status: item.status || 'exitoso',
            batch_chunk_index: Math.max(1, Number(item.batchChunkIndex) || 1),
            http_status_code: item.httpStatusCode ? Number(item.httpStatusCode) : 200,
            error_message: item.errorMessage || null,
            applied_values_json: item.appliedValues || {},
            executed_at: item.executedAt || new Date().toISOString(),
          }));

          // Insert in chunks of 50 to avoid payload size limit
          for (let i = 0; i < itemsToInsert.length; i += 50) {
            const chunk = itemsToInsert.slice(i, i + 50);
            const { error: itemsErr } = await supabase
              .from('bulk_update_job_items')
              .insert(chunk);

            if (itemsErr) {
              console.error('Error insertando detalle en bulk_update_job_items:', itemsErr);
              job.supabaseError = `Cabecera guardada en Supabase (#${supabaseDbId}), pero hubo error al registrar contactos: ${itemsErr.message}`;
              break;
            }
          }
        }

        this.updateJobInHistory(job);
        return { success: true };
      }

      job.supabaseSyncStatus = 'failed';
      job.supabaseError = 'No se obtuvo ID generado por Supabase.';
      this.updateJobInHistory(job);
      return { success: false, error: job.supabaseError };
    } catch (err: any) {
      console.error('Excepción al sincronizar con Supabase:', err);
      job.supabaseSyncStatus = 'failed';
      job.supabaseError = err.message || 'Error de conexión';
      this.updateJobInHistory(job);
      return { success: false, error: job.supabaseError };
    }
  }

  private updateJobInHistory(updated: BulkUpdateJob) {
    const idx = this.history.findIndex((j) => j.jobUuid === updated.jobUuid || j.id === updated.id);
    if (idx >= 0) {
      this.history[idx] = { ...updated };
    }
    this.persist();
  }

  /**
   * Fetches real records from Supabase if table is populated.
   */
  public async fetchFromSupabase(clientId?: number): Promise<BulkUpdateJob[]> {
    try {
      let query = supabase
        .from('bulk_update_jobs')
        .select(`
          *,
          bulk_update_job_items (*)
        `)
        .order('started_at', { ascending: false })
        .limit(100);

      if (clientId !== undefined) {
        query = query.eq('client_id', clientId);
      }

      const { data, error } = await query;
      if (!error && data && data.length > 0) {
        const mapped: BulkUpdateJob[] = data.map((row: any) => ({
          id: String(row.id),
          jobUuid: row.job_uuid || `job-${row.id}`,
          clientId: Number(row.client_id),
          executedByUsername: row.executed_by_username || 'Usuario',
          executedByUserId: row.executed_by_user_id,
          executionMode: row.execution_mode || 'lote',
          status: row.status || 'completado',
          totalTargetRecords: Number(row.total_target_records) || 0,
          successfulRecords: Number(row.successful_records) || 0,
          failedRecords: Number(row.failed_records) || 0,
          batchCount: Number(row.batch_count) || 1,
          startedAt: row.started_at,
          finishedAt: row.finished_at,
          durationMs: row.duration_ms,
          filterCriteria: row.filter_criteria_json || [],
          appliedChanges: row.payload_changes_json || [],
          errorSummary: row.error_summary,
          supabaseSyncStatus: 'synced',
          items: (row.bulk_update_job_items || []).map((it: any) => ({
            id: String(it.id),
            jobId: String(it.job_id),
            clientId: Number(it.client_id),
            recordId: it.record_id,
            recordIdentifier: it.record_identifier,
            status: it.status || 'exitoso',
            batchChunkIndex: Number(it.batch_chunk_index) || 1,
            httpStatusCode: it.http_status_code ? Number(it.http_status_code) : 200,
            errorMessage: it.error_message,
            appliedValues: it.applied_values_json || {},
            executedAt: it.executed_at,
          })),
        }));

        this.history = mapped;
        this.persist();
        return mapped;
      }
    } catch (e) {
      console.warn('Fallo al obtener historial de Supabase:', e);
    }
    return [...this.history];
  }

  /**
   * Registers a new operation in history and automatically attempts to sync it to Supabase.
   */
  public async recordJob(job: Omit<BulkUpdateJob, 'id' | 'jobUuid'>): Promise<BulkUpdateJob> {
    const rawUuid =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = (Math.random() * 16) | 0;
            const v = c === 'x' ? r : (r & 0x3) | 0x8;
            return v.toString(16);
          });

    const newJob: BulkUpdateJob = {
      ...job,
      id: `local-${Date.now()}`,
      jobUuid: rawUuid,
      supabaseSyncStatus: 'pending',
    };

    // Prepend to memory
    this.history.unshift(newJob);
    if (this.history.length > 100) {
      this.history = this.history.slice(0, 100);
    }
    this.persist();

    // Trigger Supabase persistence immediately
    await this.syncToSupabase(newJob);

    return newJob;
  }

  /**
   * Manually retries synchronization for a specific job.
   */
  public async retrySyncJob(jobUuidOrId: string): Promise<{ success: boolean; error?: string }> {
    const job = this.history.find((j) => j.jobUuid === jobUuidOrId || j.id === jobUuidOrId);
    if (!job) {
      return { success: false, error: 'Operación no encontrada en el historial local.' };
    }
    job.supabaseSyncStatus = 'pending';
    job.supabaseError = undefined;
    this.persist();
    return await this.syncToSupabase(job);
  }

  /**
   * Retries synchronization for all pending or failed jobs.
   */
  public async syncAllPending(): Promise<{ synced: number; failed: number }> {
    let synced = 0;
    let failed = 0;
    for (const job of this.history) {
      if (job.supabaseSyncStatus !== 'synced') {
        const res = await this.syncToSupabase(job);
        if (res.success) synced++;
        else failed++;
      }
    }
    return { synced, failed };
  }

  public clearHistory(): void {
    this.history = [];
    this.persist();
  }
}

export const bulkHistoryService = new BulkHistoryService();
