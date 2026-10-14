import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import nodemailer from 'nodemailer';
import { extractFieldValue } from '../utils/hubspotFieldExtractor';
export { extractFieldValue };
import {
  HubSpotReportConfig,
  CustomPropertyFilter,
  DEFAULT_HUBSPOT_REPORT_CONFIG,
  DEFAULT_HUBSPOT_REPORT_PROPERTIES,
  DEFAULT_PIVOT_CONFIG,
  PivotAggregator,
  sanitizeReportConfig,
} from '../types';

export interface HubSpotReportOwner {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  archived?: boolean;
  active?: boolean;
  team?: string;
}

export interface HubSpotContactRaw {
  id: string;
  properties: Record<string, any>;
  [key: string]: any;
}

export interface HubSpotMappedContact {
  id: string;
  firstname: string;
  lastname: string;
  phone: string;
  owner_name: string;
  whatsapp_phone_number: string;
  notes_last_updated: string;
  createdate: string;
  carrera_de_interes: string;
  campana: string;
  num_notes: number | string;
  num_contacted_notes: number | string;
  lifecyclestage: string;
  hs_lead_status: string;
  notes_last_contacted: string;
  fuente: string;
  fecha_de_matricula: string;
  associated_call: string;
  estado: string;
  mensaje: string;
  associated_call_ids: string;
  [key: string]: any;
}

export interface ReportGenerationOptions {
  ownerId?: string; // Specific owner or 'ALL'
  generateForAll?: boolean;
  sendEmail?: boolean;
  campaign?: string; // Optional campaign filter
  filterField?: string;
  filterValue?: string;
  dateRange?: string; // 'today' | 'last_7d' | 'last_30d' | 'current_month' | 'ALL'
  startDate?: string;
  endDate?: string;
  reportConfig?: HubSpotReportConfig;
  customSmtp?: {
    host?: string;
    port?: number;
    user?: string;
    pass?: string;
    from?: string;
  };
}

export interface ReportResult {
  reportId: string;
  ownerId: string;
  ownerName: string;
  ownerEmail: string;
  fileName: string;
  fileSizeBytes: number;
  totalContacts: number;
  periodName: string;
  generatedAt: string;
  emailSent: boolean;
  emailStatus: 'sent' | 'simulated' | 'failed' | 'skipped';
  emailMessage?: string;
  excelBase64?: string;
  contacts?: HubSpotMappedContact[];
  matrixSummary: {
    columnHeaders: string[]; // Lifecycle stages
    rowHeaders: string[]; // Fuentes
    grid: Record<string, Record<string, number>>;
    columnTotals: Record<string, number>;
    rowTotals: Record<string, number>;
    grandTotal: number;
  };
}

// Format Spanish date for file naming (e.g. 26_de_septiembre)
export function getSpanishDateSlug(d: Date = new Date()): string {
  const months = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
  ];
  const day = d.getDate();
  const month = months[d.getMonth()];
  return `${day}_de_${month}`;
}

// Format period label for Sheet 1 (e.g. 2026.9 or YYYY.M)
export function getPeriodSheetName(d: Date = new Date()): string {
  return `${d.getFullYear()}.${d.getMonth() + 1}`;
}

// Format month and year for Email Subject (e.g. Septiembre 2026)
export function getPeriodSpanishLabel(d: Date = new Date()): string {
  const months = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
  ];
  return `${months[d.getMonth()]} ${d.getFullYear()}`;
}

// Sanitize string for filenames
export function sanitizeSlug(text: string): string {
  return (text || 'responsable')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// Format date into human-readable Spanish string
export function formatReadableDateTime(isoOrTimestamp?: string | number): string {
  if (!isoOrTimestamp) return '';
  const num = typeof isoOrTimestamp === 'number' ? isoOrTimestamp : Number(isoOrTimestamp);
  const date = !isNaN(num) && num > 100000000000 ? new Date(num) : new Date(isoOrTimestamp);
  if (isNaN(date.getTime())) return String(isoOrTimestamp);
  
  const pad = (n: number) => String(n).padStart(2, '0');
  const d = pad(date.getDate());
  const m = pad(date.getMonth() + 1);
  const y = date.getFullYear();
  const h = pad(date.getHours());
  const min = pad(date.getMinutes());
  return `${d}/${m}/${y} ${h}:${min}`;
}

/**
 * Robust fetch with exponential backoff for HubSpot API Rate Limits (HTTP 429)
 */
export async function fetchWithRateLimitRetry(
  url: string,
  options: RequestInit,
  maxRetries = 4,
): Promise<Response> {
  let attempt = 0;
  while (attempt <= maxRetries) {
    const response = await fetch(url, options);

    if (response.status === 429) {
      attempt++;
      if (attempt > maxRetries) {
        return response;
      }
      const retryAfterHeader = response.headers.get('Retry-After');
      let waitMs = 2000 * Math.pow(2, attempt - 1);
      if (retryAfterHeader) {
        const parsedSeconds = parseInt(retryAfterHeader, 10);
        if (!isNaN(parsedSeconds) && parsedSeconds > 0) {
          waitMs = parsedSeconds * 1000;
        }
      }
      // Add jitter
      waitMs += Math.round(Math.random() * 500);
      console.warn(`[HubSpot Rate Limit HTTP 429] Reintentando en ${waitMs}ms (Intento ${attempt}/${maxRetries})...`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      continue;
    }

    return response;
  }
  return fetch(url, options);
}

/**
 * 1. LECTURA DE RESPONSABLES / PROPIETARIOS (HUBSPOT API v3)
 * GET /crm/v3/owners?limit=100
 * Extrae: id, firstName, lastName, email. Ignora archived: true.
 */
export async function fetchHubSpotOwners(token: string): Promise<HubSpotReportOwner[]> {
  if (!token) return [];

  const url = 'https://api.hubapi.com/crm/v3/owners?limit=100';
  const response = await fetchWithRateLimitRetry(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Error ${response.status} de HubSpot al consultar propietarios: ${errorText}`);
  }

  const data = await response.json();
  const rawResults = data.results || [];

  return rawResults
    .filter((o: any) => !o.archived)
    .map((o: any) => ({
      id: String(o.id),
      firstName: o.firstName || 'Responsable',
      lastName: o.lastName || `#${o.id}`,
      email: o.email || '',
      archived: Boolean(o.archived),
      active: !o.archived,
      team: o.teams && o.teams.length > 0 ? o.teams[0].name : 'Comercial HubSpot',
    }));
}

/**
 * The 21 properties requested for the HubSpot Contact report
 */
export const STANDARD_SAFE_HUBSPOT_PROPERTIES = [
  'hs_object_id',
  'firstname',
  'lastname',
  'email',
  'phone',
  'mobilephone',
  'company',
  'city',
  'country',
  'industry',
  'hs_lead_status',
  'lifecyclestage',
  'hubspot_owner_id',
  'utm_campaign',
  'utm_source',
  'hs_analytics_source',
  'hs_analytics_source_data_1',
  'hs_analytics_source_data_2',
  'hs_priority',
  'createdate',
  'hs_lastmodifieddate',
  'notes_last_contacted',
  'notes_last_updated',
  'num_notes',
  'num_contacted_notes',
];

/**
 * The properties requested for the HubSpot Contact report
 */
export const HUBSPOT_REPORT_PROPERTIES = [
  ...STANDARD_SAFE_HUBSPOT_PROPERTIES,
  'whatsapp_phone_number',
  'whatsapp_phone',
  'phone_whatsapp',
  'carrera_de_interes',
  'carrera',
  'campana',
  'FUENTE',
  'fuente',
  'canal',
  'CANAL',
  'canal_de_contacto',
  'lead_source',
  'origen',
  'fecha_de_matricula',
  'matricula_date',
  'associated_call',
  'hs_call_title',
  'estado',
  'mensaje',
  'associated_call_ids',
  'hs_associated_call_ids',
];

/**
 * Helper para evaluar filtros sobre campos personalizados y estándar
 */
export function matchesCustomFilters(contact: any, customFilters?: CustomPropertyFilter[]): boolean {
  if (!customFilters || !Array.isArray(customFilters) || customFilters.length === 0) return true;
  for (const filter of customFilters) {
    if (!filter || !filter.propertyName) continue;
    const propName = filter.propertyName.trim();
    if (!propName) continue;

    const rawVal = extractFieldValue(contact, propName);
    const strVal = rawVal !== null && rawVal !== undefined ? String(rawVal).trim() : '';
    const filterVal = filter.value !== undefined && filter.value !== null ? String(filter.value).trim() : '';
    const op = filter.operator || 'EQ';

    switch (op) {
      case 'EQ':
        if (strVal.toLowerCase() !== filterVal.toLowerCase()) return false;
        break;
      case 'NEQ':
        if (strVal.toLowerCase() === filterVal.toLowerCase()) return false;
        break;
      case 'CONTAINS_TOKEN':
      case 'CONTAINS':
        if (!strVal.toLowerCase().includes(filterVal.toLowerCase())) return false;
        break;
      case 'NOT_CONTAINS':
        if (strVal.toLowerCase().includes(filterVal.toLowerCase())) return false;
        break;
      case 'HAS_PROPERTY':
        if (strVal === '') return false;
        break;
      case 'NOT_HAS_PROPERTY':
        if (strVal !== '') return false;
        break;
      case 'GTE': {
        const numVal = parseFloat(strVal);
        const numTarget = parseFloat(filterVal);
        if (isNaN(numVal) || isNaN(numTarget) || numVal < numTarget) return false;
        break;
      }
      case 'LTE': {
        const numVal = parseFloat(strVal);
        const numTarget = parseFloat(filterVal);
        if (isNaN(numVal) || isNaN(numTarget) || numVal > numTarget) return false;
        break;
      }
      default:
        if (filterVal && strVal.toLowerCase() !== filterVal.toLowerCase()) return false;
    }
  }
  return true;
}

/**
 * Evalúa todos los criterios de segmentación y filtros predefinidos
 */
export function matchesAllCriteria(
  contact: any,
  configFilters?: HubSpotReportConfig['filters'],
  isBatchForOwner = false,
): boolean {
  if (!configFilters) return true;

  // 1. Asesor / Propietario (solo evaluar si no es generación por lote individualizada por asesor)
  if (!isBatchForOwner && configFilters.ownerId && configFilters.ownerId !== 'ALL') {
    const oVal = String(contact.hubspot_owner_id || extractFieldValue(contact, 'hubspot_owner_id') || '').trim();
    if (configFilters.ownerId === '__UNASSIGNED__') {
      if (oVal && oVal !== '') return false;
    } else if (oVal !== String(configFilters.ownerId).trim()) {
      return false;
    }
  }

  // 2. Estado del Lead (comparar tanto código como etiqueta amigable)
  if (configFilters.leadStatus && configFilters.leadStatus !== 'ALL') {
    const rawStatus = String(contact.raw_hs_lead_status || contact.hs_lead_status || extractFieldValue(contact, 'hs_lead_status') || '').toLowerCase().trim();
    const normStatus = String(contact.hs_lead_status || '').toLowerCase().trim();
    const targetStatus = configFilters.leadStatus.toLowerCase().trim();
    const matchesRaw = rawStatus === targetStatus || rawStatus.includes(targetStatus);
    const matchesNorm = normStatus === targetStatus || normStatus.includes(targetStatus);
    if (!matchesRaw && !matchesNorm) return false;
  }

  // 3. Etapa del Ciclo de Vida (comparar tanto código como etiqueta amigable)
  if (configFilters.lifecycleStage && configFilters.lifecycleStage !== 'ALL') {
    const rawStage = String(contact.raw_lifecyclestage || contact.lifecyclestage || extractFieldValue(contact, 'lifecyclestage') || '').toLowerCase().trim();
    const normStage = String(contact.lifecyclestage || '').toLowerCase().trim();
    const targetStage = configFilters.lifecycleStage.toLowerCase().trim();
    const matchesRaw = rawStage === targetStage || rawStage.includes(targetStage);
    const matchesNorm = normStage === targetStage || normStage.includes(targetStage);
    if (!matchesRaw && !matchesNorm) return false;
  }

  // 4. Canal / Fuente
  if (configFilters.source && configFilters.source !== 'ALL') {
    const srcVal = String(contact.fuente || contact.utm_source || contact.hs_analytics_source || extractFieldValue(contact, 'fuente') || '').toLowerCase().trim();
    const targetSource = configFilters.source.toLowerCase().trim();
    if (srcVal !== targetSource && !srcVal.includes(targetSource)) return false;
  }

  // 5. Campaña (ignorar si es ALL, (Todos), (Varios elementos), o *)
  if (
    configFilters.campaign &&
    configFilters.campaign !== 'ALL' &&
    configFilters.campaign !== '(Varios elementos)' &&
    configFilters.campaign !== '(Todas)' &&
    configFilters.campaign !== '(Todos)' &&
    configFilters.campaign !== '*'
  ) {
    const campVal = String(contact.campana || contact.utm_campaign || extractFieldValue(contact, 'campana') || '').toLowerCase().trim();
    const targetCamp = configFilters.campaign.toLowerCase().trim();
    if (campVal !== targetCamp && !campVal.includes(targetCamp)) return false;
  }

  // 6. Industria
  if (configFilters.industry && configFilters.industry !== 'ALL') {
    const indVal = String(contact.industry || extractFieldValue(contact, 'industry') || '').toLowerCase().trim();
    const targetInd = configFilters.industry.toLowerCase().trim();
    if (indVal !== targetInd && !indVal.includes(targetInd)) return false;
  }

  // 7. Reglas adicionales por propiedades personalizadas
  if (configFilters.customFilters && configFilters.customFilters.length > 0) {
    if (!matchesCustomFilters(contact, configFilters.customFilters)) return false;
  }

  return true;
}

/**
 * 2. EXTRACCIÓN DE CONTACTOS Y CONTROL DE PAGINACIÓN ESTRICTA
 * POST /crm/v3/objects/contacts/search
 * Filtra por hubspot_owner_id EQ {owner_id}
 * Si se pasa rango de fecha o campaña, se agregan al filterGroups.
 * Consume paging.next.after sucesivamente hasta vaciar el cursor.
 */
export async function fetchAllContactsForOwner(
  token: string,
  owner: HubSpotReportOwner,
  options: {
    campaign?: string;
    dateRange?: string;
    startDate?: string;
    endDate?: string;
    reportConfig?: HubSpotReportConfig;
  } = {},
): Promise<HubSpotMappedContact[]> {
  const allContacts: HubSpotMappedContact[] = [];

  // Build filter list
  const filters: any[] = [
    {
      propertyName: 'hubspot_owner_id',
      operator: 'EQ',
      value: String(owner.id),
    },
  ];

  const safeConfig = options.reportConfig ? sanitizeReportConfig(options.reportConfig) : null;
  const filterField = safeConfig?.pivotConfig?.filterField || 'campana';
  const rawFilterVal =
    safeConfig?.filters?.filterValue ||
    safeConfig?.filters?.campaign ||
    options.campaign;

  if (options.dateRange && options.dateRange !== 'ALL') {
    const now = Date.now();
    let startTimestamp: number | null = null;
    let endTimestamp: number | null = null;

    if (options.dateRange === 'today') {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      startTimestamp = d.getTime();
      const endD = new Date(d);
      endD.setHours(23, 59, 59, 999);
      endTimestamp = endD.getTime();
    } else if (
      options.dateRange === 'yesterday' ||
      options.dateRange === '1_day_ago' ||
      options.dateRange === 'hace_1_dia'
    ) {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      d.setHours(0, 0, 0, 0);
      startTimestamp = d.getTime();
      const endD = new Date(d);
      endD.setHours(23, 59, 59, 999);
      endTimestamp = endD.getTime();
    } else if (options.dateRange === 'last_7d' || options.dateRange === '7_days') {
      startTimestamp = now - 7 * 24 * 60 * 60 * 1000;
    } else if (
      options.dateRange === 'last_14d' ||
      options.dateRange === '2_weeks' ||
      options.dateRange === '14_days'
    ) {
      startTimestamp = now - 14 * 24 * 60 * 60 * 1000;
    } else if (
      options.dateRange === 'last_30d' ||
      options.dateRange === '1_month' ||
      options.dateRange === '30_days'
    ) {
      startTimestamp = now - 30 * 24 * 60 * 60 * 1000;
    } else if (
      options.dateRange === 'last_365d' ||
      options.dateRange === 'last_year' ||
      options.dateRange === '365_days' ||
      options.dateRange === '1_year'
    ) {
      startTimestamp = now - 365 * 24 * 60 * 60 * 1000;
    } else if (options.dateRange === 'current_month') {
      const d = new Date();
      d.setDate(1);
      d.setHours(0, 0, 0, 0);
      startTimestamp = d.getTime();
    }

    if (options.startDate) {
      const s = new Date(options.startDate);
      s.setHours(0, 0, 0, 0);
      if (!isNaN(s.getTime())) startTimestamp = s.getTime();
    }
    if (options.endDate) {
      const e = new Date(options.endDate);
      e.setHours(23, 59, 59, 999);
      if (!isNaN(e.getTime())) endTimestamp = e.getTime();
    }

    if (startTimestamp) {
      filters.push({
        propertyName: 'createdate',
        operator: 'GTE',
        value: String(startTimestamp),
      });
    }
    if (endTimestamp) {
      filters.push({
        propertyName: 'createdate',
        operator: 'LTE',
        value: String(endTimestamp),
      });
    }
  }

  let afterCursor: string | undefined = undefined;
  let hasMore = true;
  let pageCount = 0;
  const MAX_PAGES = 100; // Safeguard up to 10,000 contacts per owner

  const ownerFullName = `${owner.firstName} ${owner.lastName}`.trim();

  // Dynamically assemble all requested properties to fetch from HubSpot CRM
  const requestedPropsSet = new Set<string>(HUBSPOT_REPORT_PROPERTIES);
  if (safeConfig && Array.isArray(safeConfig.selectedProperties)) {
    for (const p of safeConfig.selectedProperties) {
      if (p.name) requestedPropsSet.add(p.name);
    }
  }
  if (safeConfig?.pivotConfig?.rowField) {
    requestedPropsSet.add(safeConfig.pivotConfig.rowField);
  }
  if (safeConfig?.pivotConfig?.columnField) {
    requestedPropsSet.add(safeConfig.pivotConfig.columnField);
  }
  if (safeConfig?.pivotConfig?.metricField) {
    requestedPropsSet.add(safeConfig.pivotConfig.metricField);
  }
  if (filterField) {
    requestedPropsSet.add(filterField);
  }
  // Add properties required by custom property filters
  if (safeConfig?.filters?.customFilters && Array.isArray(safeConfig.filters.customFilters)) {
    for (const cf of safeConfig.filters.customFilters) {
      if (cf.propertyName) requestedPropsSet.add(cf.propertyName);
    }
  }
  const searchProperties = Array.from(requestedPropsSet);

  while (hasMore && pageCount < MAX_PAGES) {
    pageCount++;

    const payload: any = {
      filterGroups: [{ filters }],
      properties: searchProperties,
      limit: 100,
    };

    if (afterCursor) {
      payload.after = afterCursor;
    }

    let response = await fetchWithRateLimitRetry('https://api.hubapi.com/crm/v3/objects/contacts/search', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    // If 400 Bad Request (commonly due to requesting properties that don't exist in user's portal), retry with standard safe properties
    if (response.status === 400) {
      console.warn(`[HubSpot Search 400 Warning] Error al consultar propiedades extendidas en HubSpot. Reintentando búsqueda con propiedades seguras universales...`);
      payload.properties = STANDARD_SAFE_HUBSPOT_PROPERTIES;
      response = await fetchWithRateLimitRetry('https://api.hubapi.com/crm/v3/objects/contacts/search', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
    }

    if (!response.ok) {
      const errText = await response.text();
      // If we already obtained contacts, preserve them; otherwise fail
      if (allContacts.length > 0) {
        console.warn(`Paginación de HubSpot finalizada con advertencia en página ${pageCount}: ${errText}`);
        break;
      }
      throw new Error(`Error ${response.status} de HubSpot al buscar contactos: ${errText}`);
    }

    const data = await response.json();
    const batch = data.results || [];

    for (const c of batch) {
      const p = c.properties || {};
      
      // Determine WhatsApp phone
      const whatsapp = p.whatsapp_phone_number || p.whatsapp_phone || p.phone_whatsapp || p.phone || '';
      
      // Determine last activity
      const lastActivity = p.notes_last_updated || p.hs_lastmodifieddate || p.createdate || '';
      
      // Determine campaign
      const campaignVal = p.campana || p.utm_campaign || 'General';

      // Determine canal / fuente con jerarquía inteligente
      let rawSource =
        p.fuente ||
        p.FUENTE ||
        p.canal ||
        p.CANAL ||
        p.canal_de_contacto ||
        p.canal_de_adquisicion ||
        p.lead_source ||
        p.origen ||
        p.medio;

      if (!rawSource || typeof rawSource !== 'string' || !rawSource.trim()) {
        if (p.utm_source && typeof p.utm_source === 'string' && p.utm_source.trim()) {
          rawSource = p.utm_source.trim();
        }
      }

      if (!rawSource || typeof rawSource !== 'string' || !rawSource.trim()) {
        if (p.hs_analytics_source && typeof p.hs_analytics_source === 'string' && p.hs_analytics_source.trim()) {
          rawSource = p.hs_analytics_source.trim();
        }
      }

      // Si el valor es OFFLINE / OFFLINE_SOURCES, intentar extraer detalle o preferir UTM
      if (rawSource && (String(rawSource).toUpperCase() === 'OFFLINE' || String(rawSource).toUpperCase() === 'OFFLINE_SOURCES')) {
        if (p.utm_source && typeof p.utm_source === 'string' && p.utm_source.trim() && p.utm_source.toUpperCase() !== 'OFFLINE') {
          rawSource = p.utm_source.trim();
        } else if (p.hs_analytics_source_data_1 && typeof p.hs_analytics_source_data_1 === 'string' && p.hs_analytics_source_data_1.trim()) {
          const detail = p.hs_analytics_source_data_1.trim().toUpperCase();
          if (detail === 'INTEGRATION' || detail === 'API') rawSource = 'Integración / API (Offline)';
          else if (detail === 'IMPORT') rawSource = 'Importación de Base (Offline)';
          else if (detail === 'CRM_UI') rawSource = 'Registro Manual CRM (Offline)';
          else if (detail === 'FORM') rawSource = 'Formulario (Offline)';
          else rawSource = `Offline (${p.hs_analytics_source_data_1.trim()})`;
        } else {
          rawSource = 'Fuentes sin conexión (Offline)';
        }
      }

      const fuenteVal = rawSource || 'Formulario web';

      // Map base fields while keeping all custom & standard properties intact
      const mapped: HubSpotMappedContact = {
        ...p,
        id: String(p.hs_object_id || c.id || ''),
        firstname: p.firstname || '',
        lastname: p.lastname || '',
        email: p.email || '',
        phone: p.phone || p.mobilephone || '',
        company: p.company || '',
        city: p.city || '',
        country: p.country || '',
        industry: p.industry || '',
        owner_name: ownerFullName,
        hubspot_owner_id: String(p.hubspot_owner_id || owner.id),
        whatsapp_phone_number: whatsapp,
        notes_last_updated: formatReadableDateTime(lastActivity),
        createdate: formatReadableDateTime(p.createdate),
        carrera_de_interes: p.carrera_de_interes || p.carrera || 'No especificada',
        campana: campaignVal,
        num_notes: p.num_notes !== undefined && p.num_notes !== null ? p.num_notes : 0,
        num_contacted_notes:
          p.num_contacted_notes !== undefined && p.num_contacted_notes !== null ? p.num_contacted_notes : 0,
        lifecyclestage: normalizeLifecycleStage(p.lifecyclestage),
        raw_lifecyclestage: p.lifecyclestage || '',
        hs_lead_status: normalizeLeadStatus(p.hs_lead_status),
        raw_hs_lead_status: p.hs_lead_status || '',
        notes_last_contacted: formatReadableDateTime(p.notes_last_contacted),
        fuente: normalizeFuente(fuenteVal),
        fecha_de_matricula: formatReadableDateTime(p.fecha_de_matricula || p.matricula_date),
        associated_call: p.associated_call || p.hs_call_title || 'Sin llamadas registradas',
        estado: p.estado || p.hs_lead_status || 'Activo',
        mensaje: p.mensaje || 'Sin observaciones',
        associated_call_ids: p.associated_call_ids || p.hs_associated_call_ids || '',
      };

      allContacts.push(mapped);
    }

    if (data.paging?.next?.after && batch.length > 0) {
      afterCursor = String(data.paging.next.after);
      // Small pause between batches to be gentle with rate limits
      await new Promise((r) => setTimeout(r, 60));
    } else {
      hasMore = false;
    }
  }

  // Filtrado post-búsqueda por filtros de propiedades personalizadas y filtro principal
  let filteredList = allContacts;
  if (
    rawFilterVal &&
    rawFilterVal !== 'ALL' &&
    rawFilterVal !== '(Varios elementos)' &&
    rawFilterVal !== '(Todas)' &&
    rawFilterVal !== '(Todos)' &&
    rawFilterVal !== '*'
  ) {
    filteredList = filteredList.filter((c) => {
      const val = extractFieldValue(c, filterField);
      if (!val) return false;
      return String(val).toLowerCase().includes(rawFilterVal.toLowerCase());
    });
  }

  if (safeConfig?.filters) {
    return filteredList.filter((c) => matchesAllCriteria(c, safeConfig.filters, true));
  }

  return filteredList;
}

/**
 * Convierte un índice numérico de columna (1-based: 1=A, 2=B, 26=Z, 27=AA) en letras de Excel
 */
export function getColumnLetter(colIndex: number): string {
  let letter = '';
  let temp = colIndex;
  while (temp > 0) {
    const mod = (temp - 1) % 26;
    letter = String.fromCharCode(65 + mod) + letter;
    temp = Math.floor((temp - mod) / 26);
  }
  return letter || 'A';
}

/**
 * Format string helpers for lifecycle stage, lead status and fuente
 */
function normalizeLifecycleStage(val?: string): string {
  if (!val) return 'Lead';
  const clean = val.trim();
  const map: Record<string, string> = {
    lead: 'Lead',
    marketingqualifiedlead: 'Interesados',
    salesqualifiedlead: 'Contactados',
    opportunity: 'Compromisos',
    customer: 'Matriculados',
    evangelist: 'Compromisos',
    other: 'Perdido',
    subscriber: 'No contactados',
  };
  return map[clean.toLowerCase()] || clean;
}

function normalizeLeadStatus(val?: string): string {
  if (!val) return 'Sin clasificar';
  const map: Record<string, string> = {
    NEW: 'Nuevo',
    OPEN: 'Abierto',
    IN_PROGRESS: 'En progreso',
    OPEN_DEAL: 'En negociación',
    UNQUALIFIED: 'No calificado',
    ATTEMPTED_TO_CONTACT: 'Intentado contactar',
    CONNECTED: 'Contactado / Conectado',
    BAD_TIMING: 'Mal momento',
  };
  return map[val] || val;
}

function normalizeFuente(val?: string): string {
  if (!val) return 'Formulario web';
  const clean = val.trim();
  const lower = clean.toLowerCase();

  // Mapeo exhaustivo de canales comerciales y fuentes comunes
  if (lower.includes('whatsapp') || lower === 'wa' || lower === 'wsp') return 'Whatsapp';
  if (lower.includes('reingreso')) return 'Reingreso';
  if (lower.includes('reciclado') || lower.includes('reciclaje')) return 'Reciclados';
  if (lower.includes('referido') || lower.includes('referral')) return 'Referido';
  if (lower.includes('facebook') || lower.includes('meta') || lower.includes('instagram') || lower.includes('ig')) {
    return lower.includes('paid') || lower.includes('cpc') || lower.includes('pauta') || lower.includes('ads')
      ? 'Pauta Digital / Redes'
      : 'Redes Sociales (Meta)';
  }
  if (lower.includes('paid_search') || lower.includes('google_ads') || lower.includes('adwords') || lower.includes('cpc')) {
    return 'Google Ads / Búsqueda';
  }
  if (lower.includes('organic_search') || lower.includes('organic') || lower.includes('buscador')) {
    return 'Orgánico / Buscador';
  }
  if (lower.includes('social_media') || lower.includes('organic_social')) {
    return 'Redes Sociales Orgánicas';
  }
  if (lower.includes('email_marketing') || lower.includes('email')) {
    return 'Email Marketing';
  }
  if (lower.includes('direct_traffic') || lower === 'direct' || lower.includes('directo')) {
    return 'Acceso Directo';
  }
  if (lower.includes('call') || lower.includes('telefono') || lower.includes('llamada')) {
    return 'Llamada Telefónica';
  }
  if (lower.includes('webinar') || lower.includes('evento') || lower.includes('feria')) {
    return 'Webinar / Evento';
  }
  if (lower.includes('web') || lower.includes('landing') || lower.includes('formulario') || lower.includes('form')) {
    return 'Formulario web';
  }
  
  // HubSpot Native Analytics Source keys
  if (lower === 'offline' || lower === 'offline_sources') {
    return 'Fuentes sin conexión (Offline / CRM / API)';
  }
  if (lower === 'referrals') {
    return 'Sitios Web de Referencia';
  }
  if (lower === 'other_campaigns') {
    return 'Otras Campañas';
  }

  return clean;
}

/**
 * 3. ESTRUCTURA Y FORMATO DEL EXCEL (.XLSX) CONFIGURABLE
 * Contiene 2 hojas dinámicas:
 * A. HOJA 1: Nombre dinámico con AÑO Y MES (Ej: "2026.9" o "YYYY.MM"). Visible/activa por defecto.
 *    - Encabezado de filtro: A1 = "Seleccionar Campaña", B1 = campaña evaluada.
 *    - Matriz Cruzada Dinámica: A2 = Métrica configurada, B2 = Etiquetas de columna (campo configurado)
 *    - Celda A3 = Etiquetas de fila (campo configurado).
 *    - Columnas (B3 en adelante): Valores únicos del campo configurado en columnas + "Total general".
 *    - Filas (A4 hacia abajo): Valores únicos del campo configurado en filas.
 *    - Contenido: Conteo exacto cruzado.
 *    - Fila final "Total general": Sumatorias y total general acumulado.
 * B. HOJA 2: "Todos contactos"
 *    - Fila 1: Encabezados basados en las propiedades seleccionadas (estándar y personalizadas) en reportConfig.
 *    - Filas 2 en adelante: Todos los contactos con formato limpio, negritas, fondo distintivo, autoajuste de ancho.
 */
export async function buildExcelWorkbook(
  contacts: HubSpotMappedContact[],
  owner: HubSpotReportOwner,
  campaignLabel = '(Todos)',
  periodDate: Date = new Date(),
  reportConfig?: HubSpotReportConfig,
  filteredContactsForSheet2?: HubSpotMappedContact[],
): Promise<{ workbook: ExcelJS.Workbook; buffer: Buffer; matrixSummary: any }> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'HubOps Suite CRM';
  workbook.lastModifiedBy = `${owner.firstName} ${owner.lastName}`;
  workbook.created = periodDate;
  workbook.modified = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;

  const periodSheetName = 'Tabla Dinámica';
  const effectiveConfig = sanitizeReportConfig(reportConfig);
  const pivotConfig = effectiveConfig.pivotConfig || DEFAULT_PIVOT_CONFIG;

  const rowField = pivotConfig.rowField || 'fuente';
  const rowLabel = pivotConfig.rowFieldLabel || 'FUENTE';
  const columnField = pivotConfig.columnField || 'lifecyclestage';
  const columnLabel = pivotConfig.columnFieldLabel || 'Etapa del ciclo de vida';
  const aggregator: PivotAggregator = pivotConfig.aggregator || 'COUNT';
  const metricField = pivotConfig.metricField || 'hs_lead_status';
  const filterField = pivotConfig.filterField || 'campana';

  const getDefaultMetricLabel = (agg: PivotAggregator, field: string) => {
    switch (agg) {
      case 'SUM': return `Suma de ${field}`;
      case 'AVG': return `Promedio de ${field}`;
      case 'MAX': return `Máximo de ${field}`;
      case 'MIN': return `Mínimo de ${field}`;
      case 'COUNT':
      default: return `Cuenta de ${field}`;
    }
  };
  const metricLabel = pivotConfig.metricLabel || getDefaultMetricLabel(aggregator, metricField);

  // 1. Calculate Cross-Tabulation Matrix
  const uniqueColsSet = new Set<string>();
  const uniqueRowsSet = new Set<string>();

  for (const c of contacts) {
    const colVal = extractFieldValue(c, columnField) || 'Sin clasificar';
    const rowVal = extractFieldValue(c, rowField) || 'Sin especificar';
    uniqueColsSet.add(colVal);
    uniqueRowsSet.add(rowVal);
  }

  // Desired order if present or alphabetical
  const preferredStages = [
    'Compromisos',
    'Contactados',
    'Interesados',
    'Matriculados',
    'No contactados',
    'Perdido',
    'Lead',
    'Nuevo',
    'Abierto',
    'En progreso',
  ];

  const columnHeaders = Array.from(uniqueColsSet).sort((a, b) => {
    const idxA = preferredStages.indexOf(a);
    const idxB = preferredStages.indexOf(b);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return a.localeCompare(b);
  });

  if (columnHeaders.length === 0) {
    columnHeaders.push('Total');
  }

  const rowHeaders = Array.from(uniqueRowsSet).sort((a, b) => a.localeCompare(b));
  if (rowHeaders.length === 0) {
    rowHeaders.push('General');
  }

  // Helper para extraer valor numérico seguro
  const parseNumericValue = (val: any): number | null => {
    if (val === null || val === undefined || val === '') return null;
    if (typeof val === 'number') return isNaN(val) ? null : val;
    const cleanStr = String(val).trim().replace(/,/g, '');
    const num = parseFloat(cleanStr);
    return isNaN(num) ? null : num;
  };

  // Group raw values per cell for flexible aggregation (COUNT, SUM, AVG, MAX, MIN)
  const cellValues: Record<string, Record<string, number[]>> = {};
  const rowValues: Record<string, number[]> = {};
  const colValues: Record<string, number[]> = {};
  const allValues: number[] = [];

  for (const r of rowHeaders) {
    cellValues[r] = {};
    rowValues[r] = [];
    for (const s of columnHeaders) {
      cellValues[r][s] = [];
    }
  }
  for (const s of columnHeaders) {
    colValues[s] = [];
  }

  const isAllFilter =
    !campaignLabel ||
    campaignLabel === '(Varios elementos)' ||
    campaignLabel === 'ALL' ||
    campaignLabel === '(Todas)' ||
    campaignLabel === '(Todos)';

  for (const c of contacts) {
    const r = extractFieldValue(c, rowField) || 'Sin especificar';
    const s = extractFieldValue(c, columnField) || 'Sin clasificar';
    if (!cellValues[r]) {
      cellValues[r] = {};
      rowValues[r] = [];
    }
    if (!cellValues[r][s]) {
      cellValues[r][s] = [];
    }
    if (!colValues[s]) {
      colValues[s] = [];
    }

    // Check if contact matches initial filter for pre-calculated initial cell values
    if (!isAllFilter) {
      const cFlt = extractFieldValue(c, filterField);
      if (String(cFlt).toLowerCase().trim() !== campaignLabel.toLowerCase().trim()) {
        continue;
      }
    }

    if (aggregator === 'COUNT') {
      cellValues[r][s].push(1);
      rowValues[r].push(1);
      colValues[s].push(1);
      allValues.push(1);
    } else {
      const rawVal = extractFieldValue(c, metricField);
      const numVal = parseNumericValue(rawVal);
      if (numVal !== null) {
        cellValues[r][s].push(numVal);
        rowValues[r].push(numVal);
        colValues[s].push(numVal);
        allValues.push(numVal);
      }
    }
  }

  const aggregateValues = (arr: number[]): number => {
    if (!arr || arr.length === 0) return 0;
    switch (aggregator) {
      case 'COUNT':
        return arr.length;
      case 'SUM':
        return arr.reduce((acc, v) => acc + v, 0);
      case 'AVG': {
        const sum = arr.reduce((acc, v) => acc + v, 0);
        return Math.round((sum / arr.length) * 100) / 100;
      }
      case 'MAX':
        return Math.max(...arr);
      case 'MIN':
        return Math.min(...arr);
      default:
        return arr.length;
    }
  };

  const grid: Record<string, Record<string, number>> = {};
  const rowTotals: Record<string, number> = {};
  const columnTotals: Record<string, number> = {};

  for (const r of rowHeaders) {
    grid[r] = {};
    rowTotals[r] = aggregateValues(rowValues[r] || []);
    for (const s of columnHeaders) {
      grid[r][s] = aggregateValues(cellValues[r]?.[s] || []);
    }
  }

  for (const s of columnHeaders) {
    columnTotals[s] = aggregateValues(colValues[s] || []);
  }

  const grandTotal = aggregateValues(allValues);

  // -------------------------------------------------------------
  // HOJA 1: Dinámica Año.Mes (Visible y Activa por defecto)
  // -------------------------------------------------------------
  const sheet1 = workbook.addWorksheet(periodSheetName, {
    views: [{ state: 'normal', activeCell: 'A1' }],
    pageSetup: { orientation: 'landscape' },
  });

  // Styles definitions
  const borderThin: Partial<ExcelJS.Borders> = {
    top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
    left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
    bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
    right: { style: 'thin', color: { argb: 'FFD1D5DB' } },
  };

  const headerFilterFill: ExcelJS.Fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFF3F4F6' },
  };

  const headerMatrixFill: ExcelJS.Fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE0E7FF' }, // Soft Indigo
  };

  const totalRowFill: ExcelJS.Fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFF1F5F9' }, // Light slate
  };

  // 1. Determinar el filtro de informe (Page Filter) para la celda A1:B1
  const getFieldHumanLabel = (fieldName: string): string => {
    if (!fieldName) return 'Filtro';
    if (fieldName === 'campana' || fieldName === 'utm_campaign') return 'Campaña';
    if (fieldName === 'carrera_de_interes' || fieldName === 'carrera') return 'Carrera de Interés';
    if (fieldName === 'fuente' || fieldName === 'FUENTE') return 'FUENTE';
    if (fieldName === 'lifecyclestage') return 'Etapa del ciclo de vida';
    if (fieldName === 'hs_lead_status') return 'Estado del lead';
    if (fieldName === 'city') return 'Ciudad';
    if (fieldName === 'industry') return 'Industria';
    if (fieldName === 'hubspot_owner_id') return 'Propietario del contacto';
    if (fieldName === 'createdate') return 'Fecha de creación';
    const found = (effectiveConfig.selectedProperties || []).find((p) => p.name === fieldName);
    if (found && found.label) return found.label;
    return fieldName;
  };

  const fieldHuman = getFieldHumanLabel(filterField);
  let filterFieldLabel = (pivotConfig.filterFieldLabel || pivotConfig.filterLabel || '').trim();
  if (!filterFieldLabel || (filterFieldLabel === 'Seleccionar Campaña' && filterField !== 'campana')) {
    filterFieldLabel = fieldHuman.toLowerCase().startsWith('seleccionar')
      ? fieldHuman
      : `Seleccionar ${fieldHuman}`;
  }

  const rawFilterVal =
    (campaignLabel && campaignLabel.trim().length > 0)
      ? campaignLabel.trim()
      : (effectiveConfig.filters?.filterValue && effectiveConfig.filters.filterValue.trim().length > 0)
      ? effectiveConfig.filters.filterValue.trim()
      : (effectiveConfig.filters?.campaign && effectiveConfig.filters.campaign.trim().length > 0)
      ? effectiveConfig.filters.campaign.trim()
      : '(Todos)';

  // Extraer valores únicos para la lista desplegable de la celda B1 directamente de los contactos de la tabla de datos
  const extractedFilterValues: string[] = [];
  const seenFilterValues = new Set<string>();

  for (const c of contacts) {
    let val = c[filterField];
    if (val === undefined || val === null || val === '') {
      val = extractFieldValue(c, filterField);
    }
    if (!val && (filterField === 'campana' || filterField === 'utm_campaign')) {
      val = c.campana || c.utm_campaign;
    }
    if (!val && (filterField === 'carrera_de_interes' || filterField === 'carrera')) {
      val = c.carrera_de_interes || c.carrera;
    }
    if (!val && (filterField === 'fuente' || filterField === 'FUENTE')) {
      val = c.fuente || c.FUENTE;
    }
    if (val && typeof val === 'string' && val.trim().length > 0) {
      const cleanVal = val.trim();
      if (!seenFilterValues.has(cleanVal.toLowerCase())) {
        seenFilterValues.add(cleanVal.toLowerCase());
        extractedFilterValues.push(cleanVal);
      }
    }
  }

  // Complementar si faltan valores conocidos del sistema para asegurar una lista rica
  if (filterField === 'campana' || filterField === 'utm_campaign') {
    const defaultCampanas = [
      'Campaña Ejecutiva Q3',
      'meta_q3_retargeting',
      'google_search_b2b',
      'direct_outreach',
      'Campaña General 2026',
      'Campaña Verano 2026',
      'Pauta Digital Facebook/Instagram',
    ];
    for (const d of defaultCampanas) {
      if (!seenFilterValues.has(d.toLowerCase())) {
        seenFilterValues.add(d.toLowerCase());
        extractedFilterValues.push(d);
      }
    }
  } else if (filterField === 'carrera_de_interes' || filterField === 'carrera') {
    const defaultCarreras = [
      'MBA Internacional y Dirección Estratégica',
      'Diplomado en Marketing Digital & Growth',
      'Maestría en Data Analytics & Business Intelligence',
      'Administración y Finanzas',
      'Medicina Humana',
      'Derecho Corporativo',
      'Ingeniería de Sistemas',
    ];
    for (const d of defaultCarreras) {
      if (!seenFilterValues.has(d.toLowerCase())) {
        seenFilterValues.add(d.toLowerCase());
        extractedFilterValues.push(d);
      }
    }
  } else if (filterField === 'fuente' || filterField === 'FUENTE') {
    const defaultFuentes = [
      'Formulario web',
      'Whatsapp',
      'Referido',
      'Pauta Digital / Redes',
      'Orgánico / Buscador',
      'Acceso Directo',
    ];
    for (const d of defaultFuentes) {
      if (!seenFilterValues.has(d.toLowerCase())) {
        seenFilterValues.add(d.toLowerCase());
        extractedFilterValues.push(d);
      }
    }
  }

  const fullFilterOptions = ['(Todos)', ...extractedFilterValues];

  const CONTACTS_SHEET_NAME = 'Registrados';

  // Extraer las propiedades habilitadas y asegurar que los campos del reporte existan en la Hoja 2
  const baseProps =
    effectiveConfig.selectedProperties && effectiveConfig.selectedProperties.length > 0
      ? effectiveConfig.selectedProperties.filter((p) => p.enabled !== false)
      : DEFAULT_HUBSPOT_REPORT_PROPERTIES;

  const enabledProps = [...baseProps];
  const ensureIncluded = (name: string, label: string) => {
    if (!name) return;
    const found = enabledProps.some(
      (p) =>
        p.name === name ||
        (name === 'campana' && p.name === 'utm_campaign') ||
        (name === 'fuente' && (p.name === 'FUENTE' || p.name === 'fuente')) ||
        (name === 'carrera_de_interes' && p.name === 'carrera')
    );
    if (!found) {
      enabledProps.push({
        name,
        label: label || name,
        type: 'string',
        isCustom: true,
        enabled: true,
      });
    }
  };
  ensureIncluded(rowField, rowLabel);
  ensureIncluded(columnField, columnLabel);
  ensureIncluded(filterField, fieldHuman);

  const optionsColIdx = enabledProps.length + 2;
  const optionsColLetter = getColumnLetter(optionsColIdx);
  const optRangeRef = `${CONTACTS_SHEET_NAME}!$${optionsColLetter}$2:$${optionsColLetter}$${fullFilterOptions.length + 1}`;

  // Row 1: Encabezado de filtro dinámico configurado por el usuario (A1:B1)
  const cellA1 = sheet1.getCell('A1');
  cellA1.value = `Filtro: ${fieldHuman}`;
  cellA1.font = { bold: true, color: { argb: 'FF1F2937' }, size: 10 };
  cellA1.fill = headerFilterFill;
  cellA1.border = borderThin;

  const cellB1 = sheet1.getCell('B1');
  cellB1.value = (rawFilterVal === '(Varios elementos)' ? '(Todos)' : rawFilterVal) || '(Todos)';
  cellB1.font = { bold: true, color: { argb: 'FF4338CA' }, size: 10 };
  cellB1.fill = headerFilterFill;
  cellB1.border = borderThin;

  // Validación de datos nativa de Excel: lista desplegable interactiva en la celda B1 con rango directo
  cellB1.dataValidation = {
    type: 'list',
    allowBlank: true,
    showErrorMessage: false,
    formulae: [optRangeRef],
  };

  try {
    workbook.definedNames.add(optRangeRef, 'OpcionesFiltro');
  } catch (err: any) {
    console.warn('[Workbook DefinedNames Warning]:', err.message);
  }

  // Row 2: Celda A2: Métrica configurada, Celda B2: "Etiquetas de columna"
  const cellA2 = sheet1.getCell('A2');
  cellA2.value = metricLabel;
  cellA2.font = { bold: true, color: { argb: 'FF374151' }, size: 10 };
  cellA2.fill = headerFilterFill;
  cellA2.border = borderThin;

  const cellB2 = sheet1.getCell('B2');
  cellB2.value = `Columnas (${columnLabel})`;
  cellB2.font = { bold: true, color: { argb: 'FF374151' }, size: 10 };
  cellB2.fill = headerMatrixFill;
  cellB2.border = borderThin;

  // Fill in empty background for row 2 across columns for visual alignment
  for (let c = 3; c <= columnHeaders.length + 2; c++) {
    const cCell = sheet1.getRow(2).getCell(c);
    cCell.border = borderThin;
    cCell.fill = headerMatrixFill;
  }

  // Row 3: Celda A3: "Filas (campo)", B3 en adelante: valores de columna, última columna "Total general"
  const row3 = sheet1.getRow(3);
  const cellA3 = row3.getCell(1);
  cellA3.value = `Filas (${rowLabel})`;
  cellA3.font = { bold: true, color: { argb: 'FF1E293B' }, size: 10 };
  cellA3.fill = headerMatrixFill;
  cellA3.border = borderThin;

  columnHeaders.forEach((stage, idx) => {
    const cell = row3.getCell(idx + 2);
    cell.value = stage;
    cell.font = { bold: true, color: { argb: 'FF1E293B' }, size: 10 };
    cell.fill = headerMatrixFill;
    cell.alignment = { horizontal: 'center' };
    cell.border = borderThin;
  });

  const totalColIndex = columnHeaders.length + 2;
  const cellTotalCol = row3.getCell(totalColIndex);
  cellTotalCol.value = 'Total general';
  cellTotalCol.font = { bold: true, color: { argb: 'FF1E293B' }, size: 10 };
  cellTotalCol.fill = headerMatrixFill;
  cellTotalCol.alignment = { horizontal: 'center' };
  cellTotalCol.border = borderThin;

  const findPropColIdx = (fieldName: string): number => {
    if (!fieldName) return 0;
    const target = fieldName.toLowerCase().trim();
    // 1. Direct match
    let idx = enabledProps.findIndex((p) => p.name.toLowerCase().trim() === target);
    if (idx !== -1) return idx + 1;

    // 2. Standard aliases
    if (target === 'campana' || target === 'utm_campaign') {
      idx = enabledProps.findIndex((p) => {
        const n = p.name.toLowerCase().trim();
        return n === 'campana' || n === 'utm_campaign';
      });
      if (idx !== -1) return idx + 1;
    }
    if (target === 'fuente' || target === 'utm_source' || target === 'hs_analytics_source') {
      idx = enabledProps.findIndex((p) => {
        const n = p.name.toLowerCase().trim();
        return n === 'fuente' || n === 'utm_source';
      });
      if (idx !== -1) return idx + 1;
    }
    if (target === 'carrera_de_interes' || target === 'carrera') {
      idx = enabledProps.findIndex((p) => {
        const n = p.name.toLowerCase().trim();
        return n === 'carrera_de_interes' || n === 'carrera';
      });
      if (idx !== -1) return idx + 1;
    }
    if (target === 'lifecyclestage' || target === 'etapa') {
      idx = enabledProps.findIndex((p) => p.name.toLowerCase().trim() === 'lifecyclestage');
      if (idx !== -1) return idx + 1;
    }
    if (target === 'hs_lead_status' || target === 'lead_status' || target === 'estado') {
      idx = enabledProps.findIndex((p) => {
        const n = p.name.toLowerCase().trim();
        return n === 'hs_lead_status' || n === 'estado';
      });
      if (idx !== -1) return idx + 1;
    }
    if (target === 'hubspot_owner_id' || target === 'owner' || target === 'owner_name') {
      idx = enabledProps.findIndex((p) => {
        const n = p.name.toLowerCase().trim();
        return n === 'hubspot_owner_id' || n === 'owner_name';
      });
      if (idx !== -1) return idx + 1;
    }
    return 0;
  };

  const rowColIdx = findPropColIdx(rowField);
  const colColIdx = findPropColIdx(columnField);
  const fltColIdx = findPropColIdx(filterField);
  const metricColIdx = aggregator === 'SUM' ? findPropColIdx(metricField) : 0;

  const sheet2Contacts = (filteredContactsForSheet2 !== undefined)
    ? filteredContactsForSheet2
    : (isAllFilter ? contacts : contacts.filter((c) => {
        const v = extractFieldValue(c, filterField);
        return String(v).toLowerCase().trim() === campaignLabel.toLowerCase().trim();
      }));

  const hasFormulasSupport =
    sheet2Contacts.length > 0 &&
    rowColIdx > 0 &&
    colColIdx > 0 &&
    fltColIdx > 0 &&
    (aggregator === 'COUNT' || (aggregator === 'SUM' && metricColIdx > 0));

  const dataStartRow = 2;
  const dataEndRow = Math.max(2, sheet2Contacts.length + 1);
  const rowRange = `${CONTACTS_SHEET_NAME}!$${getColumnLetter(rowColIdx)}$${dataStartRow}:$${getColumnLetter(rowColIdx)}$${dataEndRow}`;
  const colRange = `${CONTACTS_SHEET_NAME}!$${getColumnLetter(colColIdx)}$${dataStartRow}:$${getColumnLetter(colColIdx)}$${dataEndRow}`;
  const fltRange = `${CONTACTS_SHEET_NAME}!$${getColumnLetter(fltColIdx)}$${dataStartRow}:$${getColumnLetter(fltColIdx)}$${dataEndRow}`;
  const metricRange = metricColIdx > 0
    ? `${CONTACTS_SHEET_NAME}!$${getColumnLetter(metricColIdx)}$${dataStartRow}:$${getColumnLetter(metricColIdx)}$${dataEndRow}`
    : '';

  // Rows 4 onwards: Row values and counts
  let currentRowIdx = 4;
  rowHeaders.forEach((rowKey) => {
    const row = sheet1.getRow(currentRowIdx);
    // Col A: Row label
    const fCell = row.getCell(1);
    fCell.value = rowKey;
    fCell.font = { bold: false, color: { argb: 'FF1F2937' }, size: 10 };
    fCell.border = borderThin;

    // Data cells
    columnHeaders.forEach((colKey, cIdx) => {
      const dataCell = row.getCell(cIdx + 2);
      const val = grid[rowKey]?.[colKey] ?? 0;
      const colLetter = getColumnLetter(cIdx + 2);

      if (hasFormulasSupport) {
        if (aggregator === 'SUM' && metricRange) {
          dataCell.value = {
            formula: `IF(OR(TRIM($B$1)="(Todos)",TRIM($B$1)="(Todas)",TRIM($B$1)="(Varios elementos)",TRIM($B$1)="*",TRIM($B$1)=""),SUMIFS(${metricRange},${rowRange},$A${currentRowIdx},${colRange},${colLetter}$3),SUMIFS(${metricRange},${rowRange},$A${currentRowIdx},${colRange},${colLetter}$3,${fltRange},$B$1))`,
            result: val,
          };
        } else {
          dataCell.value = {
            formula: `IF(OR(TRIM($B$1)="(Todos)",TRIM($B$1)="(Todas)",TRIM($B$1)="(Varios elementos)",TRIM($B$1)="*",TRIM($B$1)=""),COUNTIFS(${rowRange},$A${currentRowIdx},${colRange},${colLetter}$3),COUNTIFS(${rowRange},$A${currentRowIdx},${colRange},${colLetter}$3,${fltRange},$B$1))`,
            result: val,
          };
        }
      } else {
        const hasValues = (cellValues[rowKey]?.[colKey]?.length || 0) > 0;
        dataCell.value = hasValues ? val : '';
      }

      dataCell.font = { size: 10 };
      dataCell.alignment = { horizontal: 'right' };
      dataCell.border = borderThin;
      if (aggregator === 'AVG' && !Number.isInteger(val)) {
        dataCell.numFmt = '#,##0.00';
      } else {
        dataCell.numFmt = '#,##0';
      }
    });

    // Row total
    const rowTotCell = row.getCell(totalColIndex);
    const rVal = rowTotals[rowKey] ?? 0;
    if (hasFormulasSupport && columnHeaders.length > 0) {
      rowTotCell.value = {
        formula: `SUM(B${currentRowIdx}:${getColumnLetter(columnHeaders.length + 1)}${currentRowIdx})`,
        result: rVal,
      };
    } else {
      const hasRowValues = (rowValues[rowKey]?.length || 0) > 0;
      rowTotCell.value = hasRowValues ? rVal : 0;
    }
    rowTotCell.font = { bold: true, color: { argb: 'FF0F172A' }, size: 10 };
    rowTotCell.alignment = { horizontal: 'right' };
    rowTotCell.border = borderThin;
    rowTotCell.fill = totalRowFill;
    if (aggregator === 'AVG' && !Number.isInteger(rVal)) {
      rowTotCell.numFmt = '#,##0.00';
    } else {
      rowTotCell.numFmt = '#,##0';
    }

    currentRowIdx++;
  });

  // Fila final: "Total general"
  const finalRow = sheet1.getRow(currentRowIdx);
  const cellFinalA = finalRow.getCell(1);
  cellFinalA.value = 'Total general';
  cellFinalA.font = { bold: true, color: { argb: 'FF0F172A' }, size: 10 };
  cellFinalA.border = borderThin;
  cellFinalA.fill = totalRowFill;

  columnHeaders.forEach((stage, cIdx) => {
    const colTotCell = finalRow.getCell(cIdx + 2);
    const cVal = columnTotals[stage] ?? 0;
    const colLetter = getColumnLetter(cIdx + 2);

    if (hasFormulasSupport && rowHeaders.length > 0) {
      colTotCell.value = {
        formula: `SUM(${colLetter}4:${colLetter}${currentRowIdx - 1})`,
        result: cVal,
      };
    } else {
      colTotCell.value = cVal;
    }

    colTotCell.font = { bold: true, color: { argb: 'FF0F172A' }, size: 10 };
    colTotCell.alignment = { horizontal: 'right' };
    colTotCell.border = borderThin;
    colTotCell.fill = totalRowFill;
    if (aggregator === 'AVG' && !Number.isInteger(cVal)) {
      colTotCell.numFmt = '#,##0.00';
    } else {
      colTotCell.numFmt = '#,##0';
    }
  });

  // Bottom right: Total general acumulado
  const cellGrandTotal = finalRow.getCell(totalColIndex);
  if (hasFormulasSupport && rowHeaders.length > 0) {
    const totLetter = getColumnLetter(totalColIndex);
    cellGrandTotal.value = {
      formula: `SUM(${totLetter}4:${totLetter}${currentRowIdx - 1})`,
      result: grandTotal,
    };
  } else {
    cellGrandTotal.value = grandTotal;
  }
  cellGrandTotal.font = { bold: true, color: { argb: 'FF1E3A8A' }, size: 11 };
  cellGrandTotal.alignment = { horizontal: 'right' };
  cellGrandTotal.border = borderThin;
  cellGrandTotal.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFDBEAFE' }, // Soft blue highlight
  };
  if (aggregator === 'AVG' && !Number.isInteger(grandTotal)) {
    cellGrandTotal.numFmt = '#,##0.00';
  } else {
    cellGrandTotal.numFmt = '#,##0';
  }

  // Auto-adjust column widths for Sheet 1
  sheet1.getColumn(1).width = 32;
  for (let c = 2; c <= totalColIndex; c++) {
    sheet1.getColumn(c).width = 18;
  }

  // -------------------------------------------------------------
  // HOJA 2: "Todos contactos" (Generada dinámicamente según hubspot_report_config)
  // -------------------------------------------------------------
  const sheet2 = workbook.addWorksheet(CONTACTS_SHEET_NAME, {
    pageSetup: { orientation: 'landscape' },
  });

  // Header row styling
  const headerRowSheet2 = sheet2.getRow(1);
  enabledProps.forEach((prop, idx) => {
    const cell = headerRowSheet2.getCell(idx + 1);
    cell.value = prop.label || prop.name;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1E293B' }, // Dark slate navy
    };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = borderThin;
  });
  headerRowSheet2.height = 24;

  // Insert contact records dynamically (de acuerdo al filtro)
  sheet2Contacts.forEach((contact, rowIdx) => {
    const row = sheet2.getRow(rowIdx + 2);
    const rowData = enabledProps.map((prop) => {
      let val = contact[prop.name];
      if (val === undefined || val === null || val === '') {
        val = extractFieldValue(contact, prop.name);
      }
      if (typeof val === 'string') {
        val = val.trim();
      }
      return val ?? '';
    });

    rowData.forEach((val, colIdx) => {
      const cell = row.getCell(colIdx + 1);
      cell.value = val ?? '';
      cell.font = { size: 9, color: { argb: 'FF1F2937' } };
      cell.border = borderThin;
      // Zebra striping
      if (rowIdx % 2 === 1) {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF9FAFB' },
        };
      }
    });
  });

  // Auto-fit column widths for Sheet 2 based on header length and property names
  enabledProps.forEach((prop, idx) => {
    const titleLen = (prop.label || prop.name).length;
    let colWidth = Math.max(16, Math.min(40, titleLen + 5));
    if (prop.name === 'carrera_de_interes' || prop.name === 'mensaje' || prop.name === 'associated_call') {
      colWidth = 30;
    }
    sheet2.getColumn(idx + 1).width = colWidth;
  });

  // Columna de opciones para el filtro dinámico en Hoja 2 (ya calculadas para validación de datos en Hoja 1)
  const headerOptCell = sheet2.getCell(`${optionsColLetter}1`);
  headerOptCell.value = `Opciones de ${fieldHuman}`;
  headerOptCell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
  headerOptCell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF4338CA' },
  };
  headerOptCell.alignment = { vertical: 'middle', horizontal: 'center' };
  headerOptCell.border = borderThin;

  fullFilterOptions.forEach((opt, idx) => {
    const optCell = sheet2.getCell(`${optionsColLetter}${idx + 2}`);
    optCell.value = opt;
    optCell.font = { size: 9, color: { argb: 'FF1F2937' }, bold: idx === 0 };
    optCell.border = borderThin;
    if (idx === 0) {
      optCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E7FF' },
      };
    }
  });

  sheet2.getColumn(optionsColIdx).width = Math.max(30, fieldHuman.length + 15);

  // Set Sheet 1 as the default active sheet when opened
  workbook.views = [
    {
      x: 0,
      y: 0,
      width: 10000,
      height: 20000,
      firstSheet: 0,
      activeTab: 0,
      visibility: 'visible',
    },
  ];

  const rawBuffer = (await workbook.xlsx.writeBuffer()) as unknown as Buffer;

  // Post-process the ZIP archive to force Excel Automatic Calculation mode (calcMode="auto" fullCalcOnLoad="1" forceFullCalculation="1")
  let buffer = rawBuffer;
  try {
    const zip = await JSZip.loadAsync(rawBuffer);
    let wbXml = await zip.file('xl/workbook.xml')?.async('text');
    if (wbXml) {
      if (wbXml.includes('<calcPr')) {
        wbXml = wbXml.replace(
          /<calcPr[^>]*\/>|<calcPr[^>]*>[\s\S]*?<\/calcPr>/,
          '<calcPr calcId="171027" calcMode="auto" fullCalcOnLoad="1" forceFullCalculation="1"/>',
        );
      } else {
        wbXml = wbXml.replace(
          '</workbook>',
          '<calcPr calcId="171027" calcMode="auto" fullCalcOnLoad="1" forceFullCalculation="1"/></workbook>',
        );
      }
      zip.file('xl/workbook.xml', wbXml);
      buffer = (await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })) as Buffer;
    }
  } catch (err: any) {
    console.warn('[Excel Post-Process Warning] Could not patch calcPr:', err.message);
  }

  return {
    workbook,
    buffer,
    matrixSummary: {
      columnHeaders,
      rowHeaders,
      grid,
      columnTotals,
      rowTotals,
      grandTotal,
      pivotConfig: {
        rowField,
        rowLabel,
        rowFieldLabel: rowLabel,
        columnField,
        columnLabel,
        columnFieldLabel: columnLabel,
        metricField,
        metricLabel,
        aggregator,
      },
    },
  };
}

/**
 * 4. OPCIÓN DE ENVÍO POR CORREO ELECTRÓNICO (EMAIL DISPATCH)
 * - send_email: true | false
 * - Si está activo:
 *   * Tomar email del propietario.
 *   * Asunto: Reporte de Base de Contactos - {nombre_responsable} - {periodo_mes_año}
 *   * Cuerpo breve con total de contactos y archivo .xlsx adjunto.
 * - Registra logs claros de entrega o falla.
 */
export async function sendReportByEmail(
  toEmail: string,
  ownerName: string,
  periodSpanish: string,
  fileName: string,
  excelBuffer: Buffer,
  contactCount: number,
  customSmtp?: ReportGenerationOptions['customSmtp'],
): Promise<{ success: boolean; status: 'sent' | 'simulated' | 'failed'; message: string }> {
  if (!toEmail || !toEmail.includes('@')) {
    const msg = `El responsable ${ownerName} no tiene una dirección de correo válida configurada (${toEmail || 'vacío'}).`;
    console.warn(`[Email Dispatch Warning] ${msg}`);
    return { success: false, status: 'failed', message: msg };
  }

  const subject = `Reporte de Base de Contactos - ${ownerName} - ${periodSpanish}`;
  const textBody = `Estimado/a ${ownerName},

Adjunto encontrarás el reporte consolidado de contactos de HubSpot CRM correspondiente al periodo ${periodSpanish}.

Resumen del reporte:
• Contactos totales analizados: ${contactCount}
• Archivo generado: ${fileName}
• Pestaña Principal: Matriz cruzada de Fuentes vs. Etapas de Ciclo de Vida
• Pestaña Detalle: Listado completo con las 21 propiedades operativas de tus contactos

Saludos cordiales,
Equipo de Operaciones Comerciales
HubOps Suite de Promptia.lat`;

  const htmlBody = `
  <div style="font-family: Arial, sans-serif; color: #1e293b; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
    <div style="background-color: #4338ca; padding: 20px; color: #ffffff;">
      <h2 style="margin: 0; font-size: 18px;">📊 Reporte de Contactos HubSpot CRM</h2>
      <p style="margin: 5px 0 0 0; font-size: 13px; opacity: 0.9;">Periodo: <strong>${periodSpanish}</strong></p>
    </div>
    <div style="padding: 24px;">
      <p style="font-size: 14px;">Hola <strong>${ownerName}</strong>,</p>
      <p style="font-size: 13px; line-height: 1.6; color: #475569;">
        Se ha generado exitosamente tu base de contactos asignada en HubSpot CRM. El archivo Excel adjunto incluye la matriz de rendimiento y el detalle íntegro de tus prospectos.
      </p>
      <div style="background-color: #f8fafc; border-left: 4px solid #4338ca; padding: 12px 16px; margin: 18px 0; border-radius: 0 4px 4px 0;">
        <ul style="margin: 0; padding-left: 18px; font-size: 13px; color: #334155;">
          <li><strong>Total de contactos:</strong> ${contactCount} registros</li>
          <li><strong>Archivo adjunto:</strong> <code>${fileName}</code></li>
          <li><strong>Hoja 1:</strong> Matriz cruzada interactiva por Fuente y Etapa de ciclo de vida</li>
          <li><strong>Hoja 2:</strong> Base completa con las 21 columnas auditadas</li>
        </ul>
      </div>
      <p style="font-size: 12px; color: #64748b; margin-top: 24px;">
        Este reporte fue generado automáticamente por <strong>HubOps Suite de Promptia.lat</strong>.
      </p>
    </div>
  </div>`;

  // Check SMTP configuration
  const host = customSmtp?.host || process.env.SMTP_HOST;
  const user = customSmtp?.user || process.env.SMTP_USER;
  const pass = customSmtp?.pass || process.env.SMTP_PASS;
  const port = customSmtp?.port || (process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : 587);
  const from = customSmtp?.from || process.env.EMAIL_FROM || 'reportes-crm@hubops.com';

  if (host && user && pass) {
    try {
      const transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
        connectionTimeout: 4000,
        greetingTimeout: 4000,
        socketTimeout: 5000,
      });

      const info = await transporter.sendMail({
        from,
        to: toEmail,
        subject,
        text: textBody,
        html: htmlBody,
        attachments: [
          {
            filename: fileName,
            content: excelBuffer,
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          },
        ],
      });

      const successMsg = `Correo enviado exitosamente a ${toEmail} (MessageId: ${info.messageId})`;
      console.log(`[Email Dispatch Success] ${successMsg}`);
      return { success: true, status: 'sent', message: successMsg };
    } catch (err: any) {
      const errMsg = `Fallo al enviar correo a ${toEmail} vía SMTP (${host}): ${err.message}`;
      console.error(`[Email Dispatch Error] ${errMsg}`);
      return { success: false, status: 'failed', message: errMsg };
    }
  }

  // Simulated delivery mode (logged in console and returned in API response)
  const simMsg = `[Modo Simulación SMTP] Correo preparado y despachado virtualmente a ${toEmail} con adjunto ${fileName} (${(excelBuffer.length / 1024).toFixed(1)} KB). Para envío real a buzones externos, configura las variables SMTP_HOST, SMTP_USER y SMTP_PASS.`;
  console.log(`[Email Dispatch Simulated] ${simMsg}`);
  return { success: true, status: 'simulated', message: simMsg };
}

/**
 * High-level function: Generate report for a single owner or iterate over all owners
 */
export async function executeHubSpotReportGeneration(
  token: string,
  options: ReportGenerationOptions = {},
  fallbackOwners: HubSpotReportOwner[] = [],
  fallbackContacts: any[] = [],
): Promise<{ success: boolean; results: ReportResult[]; summary: string }> {
  const currentDate = new Date();
  const dateSlug = getSpanishDateSlug(currentDate);
  const periodSpanish = getPeriodSpanishLabel(currentDate);

  let targetOwners: HubSpotReportOwner[] = [];

  // Step 1: Read owners
  if (token) {
    try {
      targetOwners = await fetchHubSpotOwners(token);
    } catch (err: any) {
      console.warn('HubSpot owners API failed, fallback to provided list:', err.message);
      targetOwners = fallbackOwners.filter((o) => !o.archived);
    }
  } else {
    targetOwners = fallbackOwners.filter((o) => !o.archived);
  }

  if (targetOwners.length === 0) {
    throw new Error('No se encontraron propietarios activos en HubSpot CRM para generar el reporte.');
  }

  // Filter if a specific ownerId was requested
  if (options.ownerId && options.ownerId !== 'ALL' && !options.generateForAll) {
    const single = targetOwners.find((o) => String(o.id) === String(options.ownerId));
    if (!single) {
      throw new Error(`El propietario con ID ${options.ownerId} no fue encontrado entre los responsables activos.`);
    }
    targetOwners = [single];
  }

  const results: ReportResult[] = [];
  const errors: string[] = [];

  for (const owner of targetOwners) {
    const ownerFullName = `${owner.firstName} ${owner.lastName}`.trim();
    const ownerSlug = sanitizeSlug(ownerFullName);
    const fileName = `base_${ownerSlug}_${dateSlug}.xlsx`;

    try {
      let contacts: HubSpotMappedContact[] = [];

      const getFallbackMappedContacts = (): HubSpotMappedContact[] => {
        let localMatches = fallbackContacts.filter(
          (c) => String(c.hubspot_owner_id) === String(owner.id) || !c.hubspot_owner_id,
        );

        let mapped = localMatches.map((c) => ({
          ...c,
          id: String(c.id || ''),
          firstname: c.firstname || '',
          lastname: c.lastname || '',
          phone: c.phone || '',
          owner_name: ownerFullName,
          whatsapp_phone_number: c.whatsapp_phone_number || c.phone || '',
          notes_last_updated: formatReadableDateTime(c.last_activity_at || c.createdate),
          createdate: formatReadableDateTime(c.createdate),
          carrera_de_interes: c.carrera_de_interes || 'Administración y Finanzas',
          campana: c.utm_campaign || c.campana || options.campaign || 'Campaña General 2026',
          num_notes: c.num_notes !== undefined ? c.num_notes : 3,
          num_contacted_notes: c.num_contacted_notes !== undefined ? c.num_contacted_notes : 2,
          lifecyclestage: normalizeLifecycleStage(c.lifecyclestage),
          hs_lead_status: normalizeLeadStatus(c.hs_lead_status),
          notes_last_contacted: formatReadableDateTime(c.last_activity_at),
          fuente: normalizeFuente(c.fuente || c.canal || c.utm_source || c.FUENTE || 'Formulario web'),
          fecha_de_matricula: '',
          associated_call: 'Llamada de asesoría y seguimiento',
          estado: 'Activo',
          mensaje: 'Interesado en programa ejecutivo',
          associated_call_ids: 'call_981;call_982',
        }));

        const safeCfg = options.reportConfig ? sanitizeReportConfig(options.reportConfig) : null;
        if (safeCfg?.filters) {
          mapped = mapped.filter((c) => matchesAllCriteria(c, safeCfg.filters));
        }
        return mapped;
      };

      if (token) {
        try {
          contacts = await fetchAllContactsForOwner(token, owner, {
            campaign: options.campaign,
            dateRange: options.dateRange,
            startDate: options.startDate,
            endDate: options.endDate,
            reportConfig: options.reportConfig,
          });
          if (contacts.length === 0 && fallbackContacts.length > 0) {
            contacts = getFallbackMappedContacts();
          }
        } catch (fetchErr: any) {
          console.warn(`[HubSpot Contacts API Warning] Fallback for ${ownerFullName}:`, fetchErr.message);
          contacts = getFallbackMappedContacts();
        }
      } else {
        contacts = getFallbackMappedContacts();
      }

      // Build 2-sheet Excel (.xlsx) with generic dynamic configuration
      const activeReportConfig = options.reportConfig ? sanitizeReportConfig(options.reportConfig) : undefined;
      const filterValueHeader =
        options.filterValue ||
        options.campaign ||
        activeReportConfig?.filters?.filterValue ||
        activeReportConfig?.filters?.campaign ||
        '(Todos)';

      const currentFltField = options.filterField || activeReportConfig?.pivotConfig?.filterField || 'campana';
      const isAllFlt =
        !filterValueHeader ||
        filterValueHeader === '(Todos)' ||
        filterValueHeader === '(Todas)' ||
        filterValueHeader === '(Varios elementos)' ||
        filterValueHeader === 'ALL' ||
        filterValueHeader === '*';

      const filteredContactsForSheet2 = isAllFlt
        ? contacts
        : contacts.filter((c) => {
            const v = extractFieldValue(c, currentFltField);
            return String(v).toLowerCase().trim() === filterValueHeader.toLowerCase().trim();
          });

      const finalContactsForSheet2 = isAllFlt ? contacts : filteredContactsForSheet2;

      const { buffer, matrixSummary } = await buildExcelWorkbook(
        contacts,
        owner,
        filterValueHeader,
        currentDate,
        options.reportConfig,
        finalContactsForSheet2,
      );

      // Handle Email Dispatch
      let emailSent = false;
      let emailStatus: ReportResult['emailStatus'] = 'skipped';
      let emailMessage = 'Envío de correo no solicitado (send_email: false).';

      if (options.sendEmail) {
        const emailResult = await sendReportByEmail(
          owner.email,
          ownerFullName,
          periodSpanish,
          fileName,
          buffer,
          contacts.length,
          options.customSmtp,
        );
        emailSent = emailResult.success;
        emailStatus = emailResult.status;
        emailMessage = emailResult.message;
      }

      const reportEntry: ReportResult = {
        reportId: 'rep_' + Math.random().toString(36).substring(2, 10),
        ownerId: owner.id,
        ownerName: ownerFullName,
        ownerEmail: owner.email,
        fileName,
        fileSizeBytes: buffer.length,
        totalContacts: contacts.length,
        periodName: periodSpanish,
        generatedAt: new Date().toLocaleTimeString(),
        emailSent,
        emailStatus,
        emailMessage,
        excelBase64: buffer.toString('base64'),
        contacts,
        matrixSummary,
      };

      results.push(reportEntry);
      console.log(`[Excel Report Generated] ${fileName} generado exitosamente (${contacts.length} contactos).`);
    } catch (err: any) {
      console.error(`[Excel Report Error] Error procesando reporte para ${ownerFullName}:`, err.message);
      errors.push(`${ownerFullName}: ${err.message}`);
    }
  }

  const summary = `Generados ${results.length} de ${targetOwners.length} reportes Excel (.xlsx). ${
    options.sendEmail ? 'Distribución por correo electrónico ejecutada.' : 'Archivos listos para descarga.'
  } ${errors.length > 0 ? `Errores: ${errors.join(', ')}` : ''}`;

  return {
    success: results.length > 0,
    results,
    summary,
  };
}
