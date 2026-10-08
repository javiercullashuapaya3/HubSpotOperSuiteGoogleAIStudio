export type LeadStatus =
  | 'NEW'
  | 'OPEN'
  | 'IN_PROGRESS'
  | 'OPEN_DEAL'
  | 'UNQUALIFIED'
  | 'ATTEMPTED_TO_CONTACT'
  | 'CONNECTED'
  | 'BAD_TIMING';

export type LifecycleStage =
  | 'subscriber'
  | 'lead'
  | 'marketingqualifiedlead'
  | 'salesqualifiedlead'
  | 'opportunity'
  | 'customer'
  | 'evangelist'
  | 'other';

export interface HubSpotOwner {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  active: boolean;
  team: string;
  avatarUrl?: string;
}

export type PriorityLevel = 'URGENT' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface HubSpotContact {
  id: string;
  firstname: string;
  lastname: string;
  email: string;
  phone: string;
  company: string;
  city?: string;
  country?: string;
  industry?: string;
  hs_lead_status: LeadStatus;
  lifecyclestage: LifecycleStage;
  hubspot_owner_id: string;
  utm_campaign: string;
  utm_source?: string;
  priority?: PriorityLevel;
  createdate: string;
  last_activity_at: string;
  hours_without_activity: number;
  [key: string]: any;
}

export interface FilterCriteria {
  ownerId: string;
  leadStatus: string;
  lifecycleStage: string;
  campaign: string;
  source?: string;
  priority?: string;
  industry?: string;
  inactivityRange?: string; // 'ALL' | 'overdue_24h' | 'overdue_48h' | 'overdue_7d' | 'recent_12h'
  dateRange?: string; // 'ALL' | 'today' | 'last_7d' | 'last_30d'
  searchKeyword: string;
  extraProperties?: string[];
}

export interface HubSpotPropertyOption {
  label: string;
  value: string;
  displayOrder?: number;
  hidden?: boolean;
}

export interface HubSpotProperty {
  name: string;
  label: string;
  type: string; // 'string' | 'number' | 'date' | 'datetime' | 'enumeration' | 'bool'
  fieldType: string; // 'text' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'booleancheckbox' | 'number' | 'date'
  groupName: string;
  description?: string;
  options?: HubSpotPropertyOption[];
  readOnlyValue?: boolean;
  calculated?: boolean;
  isCustom?: boolean;
}

export interface BulkActionPayload {
  targetOwnerId?: string; // '__UNASSIGN__' for unassigned / empty owner
  targetLeadStatus?: string;
  targetLifecycleStage?: string;
  targetCampaign?: string;
  targetSource?: string;
  targetPriority?: string;
  targetIndustry?: string;
  targetCity?: string;
  // Dynamic custom / standard properties dictionary (internal_name -> value)
  customProperties?: Record<string, string>;
  // Explicit properties to clear (set to null / empty string in HubSpot CRM)
  clearProperties?: string[];
}

export type AgentHealthStatus = 'on_track' | 'at_risk' | 'lagging';

export interface AgentMetric {
  owner: HubSpotOwner;
  totalAssignedToday: number;
  totalAccumulated: number;
  contactedToday: number;
  pendingOverdue: number;
  dailyTarget: number;
  progressPct: number;
  healthStatus: AgentHealthStatus;
  lastActivityTime: string;
}

export type NotificationChannel = 'slack' | 'whatsapp' | 'email' | 'webhook';

export type DispatchMode = 'on_demand' | 'fixed_times' | 'interval_cron' | 'conditional_alert';

export type DispatchSchedule = 'every_2h' | 'every_4h' | 'every_8h' | 'end_of_day_18' | 'manual';

export interface NotificationConfig {
  mode: DispatchMode;
  frequency?: DispatchSchedule;
  // Specific scheduled times of day (e.g. ['09:00', '14:00', '18:00'])
  scheduledTimes: string[];
  // Days of week: 1=Lun, 2=Mar, 3=Mie, 4=Jue, 5=Vie, 6=Sab, 0=Dom
  activeDays: number[];
  // Recurrence interval in minutes (e.g. 30, 60, 120, 240)
  intervalMinutes: number;
  workHoursStart: string; // e.g. "08:30"
  workHoursEnd: string;   // e.g. "18:30"
  // Target filtering
  targetAudience: 'all' | 'lagging_only' | 'at_risk_or_lagging';
  minOverdueFilter: number;
  // Channels and endpoints
  channels: NotificationChannel[];
  webhookUrl?: string;
  customTemplate: string;
  autoDispatchEnabled: boolean;
  cronExpression: string;
  timezone: string;
  lastDispatchedAt?: string;
  nextScheduledDispatch?: string;
}

export interface DispatchLogEntry {
  id: string;
  timestamp: string;
  agentName: string;
  agentEmail: string;
  channel: NotificationChannel;
  status: 'delivered' | 'failed';
  messageSnippet: string;
}

export interface McpToolLog {
  id: string;
  timestamp: string;
  tool: 'hubspot_get_owners' | 'hubspot_search_contacts' | 'hubspot_update_contact' | 'hubspot_get_agent_metrics' | 'hubspot_get_contact_properties';
  status: 'success' | 'error' | 'pending';
  latencyMs: number;
  payloadSummary: string;
  responseSummary: string;
}

export interface McpConnectionState {
  isConnected: boolean;
  mode: 'live_mcp' | 'simulated_mcp';
  privateAppToken: string;
  serverCommand: string;
  serverPackage: string;
  latencyMs: number;
  activeToolsCount: number;
  lastSyncTime: string;
}

export interface TenantCompany {
  id: string | number;
  client_id: string | number;
  name: string;
  logo: string;
  public_client_id?: string;
  api_key?: string;
  hubspot_token?: string;
  smtp_from?: string;
  smtp_apikey?: string;
  hubspot_report_config?: HubSpotReportConfig;
}

export interface HubSpotPropertyConfig {
  name: string;
  label: string;
  type?: string;
  isCustom?: boolean;
  enabled: boolean;
}

export type PivotAggregator = 'COUNT' | 'SUM' | 'AVG' | 'MAX' | 'MIN';

export interface PivotMatrixConfig {
  rowField: string;
  rowFieldLabel: string;
  columnField: string;
  columnFieldLabel: string;
  metricField: string;
  metricLabel: string;
  aggregator?: PivotAggregator;
  rowLabel?: string;
  columnLabel?: string;
  filterField?: string;
  filterFieldLabel?: string;
  filterLabel?: string;
}

export interface CustomPropertyFilter {
  id?: string;
  propertyName: string;
  operator: 'EQ' | 'NEQ' | 'CONTAINS_TOKEN' | 'GTE' | 'LTE' | 'HAS_PROPERTY' | 'NOT_HAS_PROPERTY' | string;
  value?: string;
}

export interface HubSpotReportConfig {
  selectedProperties: HubSpotPropertyConfig[];
  pivotConfig: PivotMatrixConfig;
  filters: {
    campaign?: string;
    filterValue?: string;
    dateRange?: string; // 'today' | 'yesterday' | 'last_7d' | 'last_14d' | 'last_30d' | 'current_month' | 'ALL' | 'custom'
    startDate?: string;
    endDate?: string;
    leadStatus?: string;
    lifecycleStage?: string;
    source?: string;
    ownerId?: string;
    industry?: string;
    inactivityRange?: string;
    customFilters?: CustomPropertyFilter[];
  };
  sendEmailDefault?: boolean;
  sheet1NameFormat?: 'period_year_month' | 'pivot_summary' | string;
  updatedAt?: string;
}

export const DEFAULT_HUBSPOT_REPORT_PROPERTIES: HubSpotPropertyConfig[] = [
  { name: 'hs_object_id', label: 'ID de registro', type: 'string', isCustom: false, enabled: true },
  { name: 'firstname', label: 'Nombre', type: 'string', isCustom: false, enabled: true },
  { name: 'lastname', label: 'Apellidos', type: 'string', isCustom: false, enabled: true },
  { name: 'phone', label: 'Número de teléfono', type: 'string', isCustom: false, enabled: true },
  { name: 'hubspot_owner_id', label: 'Propietario del contacto', type: 'string', isCustom: false, enabled: true },
  { name: 'whatsapp_phone_number', label: 'Número de teléfono de WhatsApp', type: 'string', isCustom: true, enabled: true },
  { name: 'notes_last_updated', label: 'Última actividad', type: 'datetime', isCustom: false, enabled: true },
  { name: 'createdate', label: 'Fecha de creación', type: 'datetime', isCustom: false, enabled: true },
  { name: 'carrera_de_interes', label: 'Carrera de Interés', type: 'string', isCustom: true, enabled: true },
  { name: 'campana', label: 'Campaña', type: 'string', isCustom: true, enabled: true },
  { name: 'num_notes', label: 'Número de actividades de ventas', type: 'number', isCustom: false, enabled: true },
  { name: 'num_contacted_notes', label: 'Número de veces contactado', type: 'number', isCustom: false, enabled: true },
  { name: 'lifecyclestage', label: 'Etapa del ciclo de vida', type: 'enumeration', isCustom: false, enabled: true },
  { name: 'hs_lead_status', label: 'Estado del lead', type: 'enumeration', isCustom: false, enabled: true },
  { name: 'notes_last_contacted', label: 'Último contacto', type: 'datetime', isCustom: false, enabled: true },
  { name: 'fuente', label: 'FUENTE', type: 'string', isCustom: true, enabled: true },
  { name: 'fecha_de_matricula', label: 'Fecha de Matrícula', type: 'date', isCustom: true, enabled: true },
  { name: 'associated_call', label: 'Associated Call', type: 'string', isCustom: true, enabled: true },
  { name: 'estado', label: 'Estado', type: 'string', isCustom: true, enabled: true },
  { name: 'mensaje', label: 'Mensaje', type: 'string', isCustom: true, enabled: true },
  { name: 'associated_call_ids', label: 'Associated Call IDs', type: 'string', isCustom: true, enabled: true },
];

export const DEFAULT_PIVOT_CONFIG: PivotMatrixConfig = {
  rowField: 'fuente',
  rowFieldLabel: 'FUENTE',
  columnField: 'lifecyclestage',
  columnFieldLabel: 'Etapa del ciclo de vida',
  metricField: 'hs_lead_status',
  metricLabel: 'Cuenta de Estado del lead',
  aggregator: 'COUNT',
  filterField: 'campana',
  filterFieldLabel: 'Seleccionar Campaña',
};

export const DEFAULT_HUBSPOT_REPORT_CONFIG: HubSpotReportConfig = {
  selectedProperties: DEFAULT_HUBSPOT_REPORT_PROPERTIES,
  pivotConfig: DEFAULT_PIVOT_CONFIG,
  filters: {
    campaign: '(Varios elementos)',
    filterValue: '(Varios elementos)',
    dateRange: 'last_365d',
    startDate: '',
    endDate: '',
    customFilters: [],
  },
  sendEmailDefault: true,
  sheet1NameFormat: 'period_year_month',
  updatedAt: new Date().toISOString(),
};

export function sanitizeReportConfig(raw: any): HubSpotReportConfig {
  if (!raw) {
    return { ...DEFAULT_HUBSPOT_REPORT_CONFIG };
  }

  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch (_) {
      return { ...DEFAULT_HUBSPOT_REPORT_CONFIG };
    }
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { ...DEFAULT_HUBSPOT_REPORT_CONFIG };
  }

  const selectedProperties: HubSpotPropertyConfig[] =
    Array.isArray(parsed.selectedProperties) && parsed.selectedProperties.length > 0
      ? parsed.selectedProperties
          .filter((p: any) => p && typeof p === 'object' && typeof p.name === 'string' && p.name.trim().length > 0)
          .map((p: any) => ({
            name: String(p.name).trim(),
            label: String(p.label || p.name).trim(),
            type: p.type || 'string',
            isCustom: Boolean(p.isCustom),
            enabled: p.enabled !== false,
          }))
      : DEFAULT_HUBSPOT_REPORT_PROPERTIES;

  const rawPivot = parsed.pivotConfig && typeof parsed.pivotConfig === 'object' ? parsed.pivotConfig : {};
  const validAggregators: PivotAggregator[] = ['COUNT', 'SUM', 'AVG', 'MAX', 'MIN'];
  const rawAgg = typeof rawPivot.aggregator === 'string' ? rawPivot.aggregator.toUpperCase().trim() : '';
  const aggregator: PivotAggregator = validAggregators.includes(rawAgg as PivotAggregator)
    ? (rawAgg as PivotAggregator)
    : DEFAULT_PIVOT_CONFIG.aggregator || 'COUNT';

  const filterField = typeof rawPivot.filterField === 'string' && rawPivot.filterField.trim()
    ? rawPivot.filterField.trim()
    : DEFAULT_PIVOT_CONFIG.filterField || 'campana';

  const filterFieldLabel = typeof rawPivot.filterFieldLabel === 'string' && rawPivot.filterFieldLabel.trim()
    ? rawPivot.filterFieldLabel.trim()
    : (rawPivot.filterLabel || DEFAULT_PIVOT_CONFIG.filterFieldLabel || 'Seleccionar Campaña');

  const pivotConfig: PivotMatrixConfig = {
    rowField: typeof rawPivot.rowField === 'string' && rawPivot.rowField.trim() ? rawPivot.rowField.trim() : DEFAULT_PIVOT_CONFIG.rowField,
    rowFieldLabel: typeof rawPivot.rowFieldLabel === 'string' && rawPivot.rowFieldLabel.trim() ? rawPivot.rowFieldLabel.trim() : (rawPivot.rowLabel || DEFAULT_PIVOT_CONFIG.rowFieldLabel),
    columnField: typeof rawPivot.columnField === 'string' && rawPivot.columnField.trim() ? rawPivot.columnField.trim() : DEFAULT_PIVOT_CONFIG.columnField,
    columnFieldLabel: typeof rawPivot.columnFieldLabel === 'string' && rawPivot.columnFieldLabel.trim() ? rawPivot.columnFieldLabel.trim() : (rawPivot.columnLabel || DEFAULT_PIVOT_CONFIG.columnFieldLabel),
    metricField: typeof rawPivot.metricField === 'string' && rawPivot.metricField.trim() ? rawPivot.metricField.trim() : DEFAULT_PIVOT_CONFIG.metricField,
    metricLabel: typeof rawPivot.metricLabel === 'string' && rawPivot.metricLabel.trim() ? rawPivot.metricLabel.trim() : DEFAULT_PIVOT_CONFIG.metricLabel,
    aggregator,
    rowLabel: rawPivot.rowLabel || rawPivot.rowFieldLabel || DEFAULT_PIVOT_CONFIG.rowFieldLabel,
    columnLabel: rawPivot.columnLabel || rawPivot.columnFieldLabel || DEFAULT_PIVOT_CONFIG.columnFieldLabel,
    filterField,
    filterFieldLabel,
    filterLabel: filterFieldLabel,
  };

  const rawFilters = parsed.filters && typeof parsed.filters === 'object' ? parsed.filters : {};
  const effectiveFilterVal = rawFilters.filterValue || rawFilters.campaign || '(Varios elementos)';
  return {
    selectedProperties: selectedProperties.length > 0 ? selectedProperties : DEFAULT_HUBSPOT_REPORT_PROPERTIES,
    pivotConfig,
    filters: {
      campaign: effectiveFilterVal,
      filterValue: effectiveFilterVal,
      dateRange: rawFilters.dateRange || 'last_365d',
      startDate: rawFilters.startDate || '',
      endDate: rawFilters.endDate || '',
      leadStatus: rawFilters.leadStatus || '',
      lifecycleStage: rawFilters.lifecycleStage || '',
      source: rawFilters.source || '',
      ownerId: rawFilters.ownerId || '',
      industry: rawFilters.industry || '',
      inactivityRange: rawFilters.inactivityRange || '',
      customFilters: Array.isArray(rawFilters.customFilters)
        ? rawFilters.customFilters
            .filter((cf: any) => cf && typeof cf.propertyName === 'string' && cf.propertyName.trim())
            .map((cf: any) => ({
              id: cf.id || `flt_${Math.random().toString(36).substring(2, 9)}`,
              propertyName: cf.propertyName.trim(),
              operator: cf.operator || 'EQ',
              value: cf.value !== undefined ? String(cf.value) : '',
            }))
        : [],
    },
    sendEmailDefault: parsed.sendEmailDefault !== undefined ? Boolean(parsed.sendEmailDefault) : true,
    sheet1NameFormat: parsed.sheet1NameFormat || 'period_year_month',
    updatedAt: parsed.updatedAt || new Date().toISOString(),
  };
}
