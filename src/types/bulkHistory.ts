/**
 * Bulk Update Operations History & MySQL Schema Definitions
 * Provides logging data models and production-ready MySQL DDL for auditing bulk operations.
 */

export type ExecutionMode = 'lote' | 'individual';
export type JobStatus = 'completado' | 'parcialmente_fallido' | 'fallido' | 'en_proceso' | 'pendiente';
export type ItemStatus = 'exitoso' | 'fallido' | 'omitido';

export interface BulkUpdateJobItem {
  id: string;
  jobId: string;
  clientId: number;
  recordId: string; // Contact ID in HubSpot CRM
  recordIdentifier: string; // Contact full name or email for human readability
  status: ItemStatus;
  batchChunkIndex: number;
  httpStatusCode?: number;
  errorMessage?: string;
  appliedValues: Record<string, any>;
  executedAt: string;
}

export interface BulkUpdateJob {
  id: string;
  jobUuid: string;
  clientId: number;
  executedByUsername: string;
  executedByUserId?: string;
  executionMode: ExecutionMode;
  status: JobStatus;
  totalTargetRecords: number;
  successfulRecords: number;
  failedRecords: number;
  batchCount: number;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  filterCriteria: { label: string; value: string }[];
  appliedChanges: { label: string; value: string; isClear?: boolean }[];
  errorSummary?: string;
  items?: BulkUpdateJobItem[];
  // Supabase audit sync tracking
  supabaseSyncStatus?: 'synced' | 'pending' | 'failed' | 'rls_blocked';
  supabaseError?: string;
}

/**
 * Generic MySQL 8.0+ Table DDL Schema (Header & Detail)
 * Table names and column names in English; enumerated values, defaults, and business content in Spanish.
 */
export const MYSQL_BULK_LOGS_DDL = `-- =====================================================================
-- TABLAS GENÉRICAS EN MYSQL PARA AUDITORÍA DE ACTUALIZACIONES MASIVAS
-- Cabecera y Detalle con nombres de tablas y columnas en inglés,
-- y valores enumerados (ENUM) y estados por defecto en español.
-- =====================================================================

-- 1. TABLA CABECERA: bulk_update_jobs
-- Guarda el resumen de la ejecución, filtros aplicados, cambios y totales.
CREATE TABLE IF NOT EXISTS \`bulk_update_jobs\` (
  \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  \`job_uuid\` CHAR(36) NOT NULL COMMENT 'Identificador único universal de la operación',
  \`client_id\` INT UNSIGNED NOT NULL COMMENT 'Identificador numérico del cliente o empresa (multi-tenant)',
  \`executed_by_username\` VARCHAR(150) NOT NULL COMMENT 'Nombre o correo del usuario de sesión que ejecutó la actualización',
  \`executed_by_user_id\` VARCHAR(64) DEFAULT NULL COMMENT 'ID de cuenta de usuario en el sistema de autenticación',
  \`execution_mode\` ENUM('lote', 'individual') NOT NULL DEFAULT 'lote' COMMENT 'Modo de ejecución: lote o individual',
  \`status\` ENUM('pendiente', 'en_proceso', 'completado', 'parcialmente_fallido', 'fallido') NOT NULL DEFAULT 'completado' COMMENT 'Estado general de la operación masiva',
  \`total_target_records\` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Total de registros seleccionados para modificar',
  \`successful_records\` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Cantidad de registros actualizados exitosamente en HubSpot',
  \`failed_records\` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Cantidad de registros con error al actualizar',
  \`batch_count\` INT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'Cantidad de paquetes o llamadas enviadas a la API',
  \`filter_criteria_json\` JSON DEFAULT NULL COMMENT 'JSON con los filtros de búsqueda y segmentación aplicados',
  \`payload_changes_json\` JSON NOT NULL COMMENT 'JSON con los campos y valores modificados o limpiados',
  \`error_summary\` TEXT DEFAULT NULL COMMENT 'Resumen del error en caso de fallo parcial o total',
  \`started_at\` DATETIME NOT NULL COMMENT 'Fecha y hora de inicio de la ejecución',
  \`finished_at\` DATETIME DEFAULT NULL COMMENT 'Fecha y hora de finalización',
  \`duration_ms\` INT UNSIGNED DEFAULT NULL COMMENT 'Duración total de la operación en milisegundos',
  \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uk_job_uuid\` (\`job_uuid\`),
  KEY \`idx_client_created\` (\`client_id\`, \`created_at\` DESC),
  KEY \`idx_client_user\` (\`client_id\`, \`executed_by_username\`),
  KEY \`idx_status\` (\`status\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Tabla cabecera de auditoría para operaciones masivas por cliente y usuario';

-- 2. TABLA DETALLE: bulk_update_job_items
-- Guarda cada contacto individual procesado dentro de la operación masiva.
CREATE TABLE IF NOT EXISTS \`bulk_update_job_items\` (
  \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  \`job_id\` BIGINT UNSIGNED NOT NULL COMMENT 'Clave foránea hacia bulk_update_jobs.id',
  \`client_id\` INT UNSIGNED NOT NULL COMMENT 'Identificador numérico del cliente (para particionamiento y seguridad)',
  \`record_id\` VARCHAR(100) NOT NULL COMMENT 'ID del contacto u objeto en HubSpot CRM',
  \`record_identifier\` VARCHAR(255) DEFAULT NULL COMMENT 'Identificador legible (nombre completo o correo del lead)',
  \`status\` ENUM('exitoso', 'fallido', 'omitido') NOT NULL DEFAULT 'exitoso' COMMENT 'Resultado individual del contacto en HubSpot',
  \`batch_chunk_index\` INT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'Número de paquete o bloque al que perteneció este registro',
  \`http_status_code\` SMALLINT UNSIGNED DEFAULT NULL COMMENT 'Código de respuesta HTTP devuelto por la API (ej: 200, 400)',
  \`error_message\` TEXT DEFAULT NULL COMMENT 'Detalle del mensaje de error si el contacto fue rechazado',
  \`applied_values_json\` JSON DEFAULT NULL COMMENT 'JSON con los valores efectivamente aplicados a este contacto',
  \`executed_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`),
  KEY \`idx_job_record\` (\`job_id\`, \`record_id\`),
  KEY \`idx_client_status\` (\`client_id\`, \`status\`),
  KEY \`idx_record_id\` (\`record_id\`),
  CONSTRAINT \`fk_bulk_items_job\` FOREIGN KEY (\`job_id\`) REFERENCES \`bulk_update_jobs\` (\`id\`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Tabla detalle para el registro individual de cada lead procesado';
`;

/**
 * Supabase (PostgreSQL) DDL Schema (Header & Detail)
 * Tables and columns in English, client_id (BIGINT / INTEGER),
 * JSONB for snapshots, and Spanish ENUM / CHECK constraints.
 */
export const SUPABASE_BULK_LOGS_DDL = `-- =====================================================================
-- TABLAS EN SUPABASE / POSTGRESQL PARA AUDITORÍA DE ACTUALIZACIONES MASIVAS
-- Tablas y columnas en inglés, client_id (BIGINT / INTEGER),
-- valores en español y políticas de seguridad RLS incluidas.
-- =====================================================================

-- 1. TABLA CABECERA: bulk_update_jobs
CREATE TABLE IF NOT EXISTS public.bulk_update_jobs (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  job_uuid UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  client_id BIGINT NOT NULL, -- Identificador numérico del cliente / empresa
  executed_by_username TEXT NOT NULL, -- Usuario de sesión que ejecutó la acción
  executed_by_user_id TEXT, -- ID de auth.users si existe
  execution_mode TEXT NOT NULL DEFAULT 'lote' CHECK (execution_mode IN ('lote', 'individual')),
  status TEXT NOT NULL DEFAULT 'completado' CHECK (status IN ('pendiente', 'en_proceso', 'completado', 'parcialmente_fallido', 'fallido')),
  total_target_records INTEGER NOT NULL DEFAULT 0,
  successful_records INTEGER NOT NULL DEFAULT 0,
  failed_records INTEGER NOT NULL DEFAULT 0,
  batch_count INTEGER NOT NULL DEFAULT 1,
  filter_criteria_json JSONB DEFAULT '[]'::jsonb,
  payload_changes_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  error_summary TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices de consulta rápida
CREATE INDEX IF NOT EXISTS idx_bulk_jobs_client_created ON public.bulk_update_jobs (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bulk_jobs_client_user ON public.bulk_update_jobs (client_id, executed_by_username);
CREATE INDEX IF NOT EXISTS idx_bulk_jobs_status ON public.bulk_update_jobs (status);

-- 2. TABLA DETALLE: bulk_update_job_items
CREATE TABLE IF NOT EXISTS public.bulk_update_job_items (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  job_id BIGINT NOT NULL REFERENCES public.bulk_update_jobs (id) ON DELETE CASCADE,
  client_id BIGINT NOT NULL, -- Identificador numérico del cliente (para partición y seguridad)
  record_id TEXT NOT NULL, -- ID del contacto en HubSpot CRM
  record_identifier TEXT, -- Nombre o email del lead para lectura humana
  status TEXT NOT NULL DEFAULT 'exitoso' CHECK (status IN ('exitoso', 'fallido', 'omitido')),
  batch_chunk_index INTEGER NOT NULL DEFAULT 1,
  http_status_code SMALLINT DEFAULT 200,
  error_message TEXT,
  applied_values_json JSONB DEFAULT '{}'::jsonb,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices de consulta rápida
CREATE INDEX IF NOT EXISTS idx_bulk_items_job_record ON public.bulk_update_job_items (job_id, record_id);
CREATE INDEX IF NOT EXISTS idx_bulk_items_client_status ON public.bulk_update_job_items (client_id, status);
CREATE INDEX IF NOT EXISTS idx_bulk_items_record_id ON public.bulk_update_job_items (record_id);

-- 3. SEGURIDAD EN SUPABASE: DESHABILITAR RLS (RECOMENDADO) O CREAR POLÍTICAS
-- Opción 1 (Recomendada): Deshabilitar RLS para auditoría abierta (Igual que tabla companies)
ALTER TABLE public.bulk_update_jobs DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.bulk_update_job_items DISABLE ROW LEVEL SECURITY;

-- Opción 2 (Alternativa): Si mantienes RLS habilitado, crea políticas abiertas para anon y authenticated:
-- ALTER TABLE public.bulk_update_jobs ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.bulk_update_job_items ENABLE ROW LEVEL SECURITY;
-- DROP POLICY IF EXISTS "Permitir auditoria bulk jobs" ON public.bulk_update_jobs;
-- CREATE POLICY "Permitir auditoria bulk jobs" ON public.bulk_update_jobs FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
-- DROP POLICY IF EXISTS "Permitir auditoria bulk items" ON public.bulk_update_job_items;
-- CREATE POLICY "Permitir auditoria bulk items" ON public.bulk_update_job_items FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
`;
