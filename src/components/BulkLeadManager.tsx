import React, { useState, useEffect, useMemo } from 'react';
import {
  Users,
  Search,
  Filter,
  RefreshCw,
  ArrowRightLeft,
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Briefcase,
  Sparkles,
  UserCheck,
  CheckSquare,
  Square,
  X,
  MapPin,
  Building2,
  Flame,
  UserX,
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
  Zap,
  Layers,
  Plus,
  Trash2,
  Database,
  Tag,
  Columns,
  Eye,
  Check,
  HelpCircle,
  History,
  FileCode,
  Maximize2,
  ArrowDown,
  Activity,
  Copy,
} from 'lucide-react';
import {
  BulkActionPayload,
  FilterCriteria,
  HubSpotContact,
  HubSpotOwner,
  HubSpotProperty,
  LeadStatus,
  LifecycleStage,
  PriorityLevel,
} from '../types';
import { mcpHubspot } from '../services/mcpHubspot';
import { useAuth } from '../context/AuthContext';
import { bulkHistoryService } from '../services/bulkHistoryService';
import { BulkOperationsHistoryCard } from './BulkOperationsHistoryCard';
import { MYSQL_BULK_LOGS_DDL, SUPABASE_BULK_LOGS_DDL } from '../types/bulkHistory';

interface BulkLeadManagerProps {
  owners: HubSpotOwner[];
  onDataModified?: () => void;
}

const LEAD_STATUS_LABELS: Record<LeadStatus, { label: string; color: string }> = {
  NEW: { label: 'Nuevo', color: 'bg-blue-100 text-blue-800 border-blue-200' },
  OPEN: { label: 'Abierto', color: 'bg-sky-100 text-sky-800 border-sky-200' },
  IN_PROGRESS: { label: 'En Progreso', color: 'bg-indigo-100 text-indigo-800 border-indigo-200' },
  OPEN_DEAL: { label: 'Negocio Abierto', color: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  UNQUALIFIED: { label: 'Descalificado', color: 'bg-rose-100 text-rose-800 border-rose-200' },
  ATTEMPTED_TO_CONTACT: { label: 'Intento de Contacto', color: 'bg-amber-100 text-amber-800 border-amber-200' },
  CONNECTED: { label: 'Conectado', color: 'bg-teal-100 text-teal-800 border-teal-200' },
  BAD_TIMING: { label: 'Momento Inoportuno', color: 'bg-slate-100 text-slate-700 border-slate-300' },
};

const LIFECYCLE_LABELS: Record<LifecycleStage, string> = {
  subscriber: 'Suscriptor',
  lead: 'Lead General',
  marketingqualifiedlead: 'MQL (Marketing Qualified)',
  salesqualifiedlead: 'SQL (Sales Qualified)',
  opportunity: 'Oportunidad Comercial',
  customer: 'Cliente Ganado',
  evangelist: 'Evangelista',
  other: 'Otro / Inactivo',
};

const PRIORITY_LABELS: Record<PriorityLevel, { label: string; color: string }> = {
  URGENT: { label: 'Urgente', color: 'bg-red-100 text-red-700 border-red-200' },
  HIGH: { label: 'Alta', color: 'bg-amber-100 text-amber-700 border-amber-200' },
  MEDIUM: { label: 'Media', color: 'bg-blue-100 text-blue-700 border-blue-200' },
  LOW: { label: 'Baja', color: 'bg-slate-100 text-slate-600 border-slate-200' },
};

const INDUSTRY_OPTIONS = [
  'Tecnología y Software',
  'Retail y Comercio',
  'Finanzas y Banca',
  'Salud y Farmacia',
  'Logística y Transporte',
  'Energía y Minería',
  'Construcción e Inmobiliaria',
  'Agroindustria',
  'Educación',
  'Servicios Profesionales',
];

const SOURCE_OPTIONS = [
  'Whatsapp',
  'Formulario web',
  'Pauta Digital / Redes',
  'Meta Ads',
  'Google Search',
  'Orgánico / Buscador',
  'LinkedIn B2B',
  'Prospección en Frío',
  'Webinars y Eventos',
  'Referidos',
  'Fuentes sin conexión (Offline)',
];

export const BulkLeadManager: React.FC<BulkLeadManagerProps> = ({ owners, onDataModified }) => {
  // Filter States - All properties allowed by MCP & HubSpot Search API
  const [filters, setFilters] = useState<FilterCriteria>({
    ownerId: 'ALL',
    leadStatus: 'ALL',
    lifecycleStage: 'ALL',
    campaign: 'ALL',
    source: 'ALL',
    priority: 'ALL',
    industry: 'ALL',
    inactivityRange: 'ALL',
    dateRange: 'last_365d',
    searchKeyword: '',
  });

  const [showAdvancedFilters, setShowAdvancedFilters] = useState<boolean>(true);
  const [contacts, setContacts] = useState<HubSpotContact[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(new Set());

  // Bulk Action Values - All properties that can be modified in batch via MCP
  const [actionPayload, setActionPayload] = useState<BulkActionPayload>({
    targetOwnerId: '',
    targetLeadStatus: '',
    targetLifecycleStage: '',
    targetCampaign: '',
    targetSource: '',
    targetPriority: '',
    targetIndustry: '',
    targetCity: '',
  });

  // Track standard fields marked to be cleared (null/empty) in bulk
  const [clearFields, setClearFields] = useState<{
    owner?: boolean;
    campaign?: boolean;
    source?: boolean;
    priority?: boolean;
    industry?: boolean;
    city?: boolean;
  }>({});

  // Dynamic & Custom Properties state
  const [availableProperties, setAvailableProperties] = useState<HubSpotProperty[]>([]);
  const [isLoadingProperties, setIsLoadingProperties] = useState<boolean>(false);
  const [customPropertiesToEdit, setCustomPropertiesToEdit] = useState<{
    propertyName: string;
    value: string;
    isNullOrEmpty?: boolean;
  }[]>([]);
  const [selectedPropertyToAdd, setSelectedPropertyToAdd] = useState<string>('');

  // Helper to determine if a property allows being set to null/empty in HubSpot
  const canPropertyBeCleared = (propertyName: string): { allowed: boolean; reason?: string } => {
    if (propertyName === 'lifecyclestage') {
      return { allowed: false, reason: 'Etapa del ciclo de vida es requerida por HubSpot' };
    }
    if (propertyName === 'email') {
      return { allowed: false, reason: 'Identificador clave en HubSpot' };
    }
    const propDef = availableProperties.find((p) => p.name === propertyName);
    if (propDef) {
      if (propDef.readOnlyValue) {
        return { allowed: false, reason: 'Propiedad de solo lectura' };
      }
      if (propDef.calculated) {
        return { allowed: false, reason: 'Propiedad calculada automáticamente' };
      }
    }
    return { allowed: true };
  };

  // Table Custom / Dynamic Columns State
  const [visibleCustomColumnNames, setVisibleCustomColumnNames] = useState<string[]>([
    'motivo_contacto_personalizado',
    'sucursal_asignada',
    'monto_presupuesto_estimado',
  ]);
  const [isColumnPickerOpen, setIsColumnPickerOpen] = useState<boolean>(false);
  const [columnSearchQuery, setColumnSearchQuery] = useState<string>('');
  const [columnFilterTab, setColumnFilterTab] = useState<'all' | 'custom' | 'standard' | 'selected'>('all');

  const fetchProperties = async () => {
    setIsLoadingProperties(true);
    try {
      const props = await mcpHubspot.hubspot_get_contact_properties();
      setAvailableProperties(props);
    } catch (e) {
      console.warn('Error loading HubSpot properties:', e);
    } finally {
      setIsLoadingProperties(false);
    }
  };

  useEffect(() => {
    fetchProperties();
  }, []);

  // Modal and Execution States
  const [hasSearched, setHasSearched] = useState<boolean>(false);
  const [executionStrategy, setExecutionStrategy] = useState<'batch_chunks' | 'mcp_individual_queue'>('batch_chunks');
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState<boolean>(false);
  const [confirmKeyword, setConfirmKeyword] = useState<string>('');
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [executionProgress, setExecutionProgress] = useState<{
    current: number;
    total: number;
    pct: number;
    currentBatch?: number;
    totalBatches?: number;
    statusText?: string;
    log: { id: string; contactId: string; success: boolean; time: string; status?: string }[];
  }>({
    current: 0,
    total: 0,
    pct: 0,
    log: [],
  });
  const [executionComplete, setExecutionComplete] = useState<boolean>(false);

  // Authentication & History Logging state
  const { userName, user, company } = useAuth();
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState<boolean>(false);
  const [isActionPanelPopupOpen, setIsActionPanelPopupOpen] = useState<boolean>(false);
  const [lastJobId, setLastJobId] = useState<string | undefined>();
  const [resultsActiveTab, setResultsActiveTab] = useState<'current' | 'history'>('current');
  const [isManualCampaign, setIsManualCampaign] = useState<boolean>(false);
  const [portalCampaigns, setPortalCampaigns] = useState<string[]>([]);

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('hubspot_token') || '' : '';
    fetch('/api/reports/filter-options', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.options?.campana && Array.isArray(data.options.campana)) {
          setPortalCampaigns(
            data.options.campana.filter(
              (c: string) => c && c !== '(Varios elementos)' && c !== '(Todas)' && c !== '(Todos)',
            ),
          );
        }
      })
      .catch(() => {});
  }, []);

  // Load Contacts with extra properties
  const fetchContacts = async (
    appliedFilters: FilterCriteria = filters,
    extraCols: string[] = visibleCustomColumnNames
  ) => {
    setIsLoading(true);
    setHasSearched(true);
    try {
      const criteria: FilterCriteria = {
        ...appliedFilters,
        extraProperties: extraCols,
      };
      const results = await mcpHubspot.hubspot_search_contacts(criteria);
      setContacts(results);
      // Auto select all initially or preserve
      setSelectedContactIds(new Set(results.map((c) => c.id)));
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleColumn = (propName: string) => {
    setVisibleCustomColumnNames((prev) => {
      const exists = prev.includes(propName);
      const next = exists ? prev.filter((p) => p !== propName) : [...prev, propName];
      if (hasSearched) {
        fetchContacts(filters, next);
      }
      return next;
    });
  };

  useEffect(() => {
    // Do NOT auto-load all contacts on initial mount.
    // The user must click "Aplicar Filtros y Buscar" to load leads.
    const unsub = mcpHubspot.subscribeStatus(() => {
      if (hasSearched) {
        fetchContacts();
      }
    });
    return () => unsub();
  }, [owners, hasSearched]);

  // Distinct campaigns for filter dropdown and destination bulk modification
  const uniqueCampaigns = useMemo(() => {
    const list = new Set<string>([
      'meta_q3_retargeting',
      'google_search_b2b',
      'linkedin_inbound',
      'webinar_tech_summit',
      'direct_outreach',
      'Campaña General 2026',
      'Campaña Ejecutiva Q3',
      'Pauta Digital Facebook/Instagram',
    ]);
    portalCampaigns.forEach((c) => {
      if (c && typeof c === 'string') list.add(c.trim());
    });
    contacts.forEach((c) => {
      if (c.utm_campaign) list.add(c.utm_campaign.trim());
      if ((c as any).campana) list.add(String((c as any).campana).trim());
    });
    return Array.from(list).filter(Boolean).sort((a, b) => a.localeCompare(b));
  }, [contacts, portalCampaigns]);

  // Distinct sources for filter dropdown
  const uniqueSources = useMemo(() => {
    const list = new Set<string>(SOURCE_OPTIONS);
    contacts.forEach((c) => {
      if (c.utm_source) list.add(c.utm_source);
    });
    return Array.from(list);
  }, [contacts]);

  // Toggle selection
  const handleToggleSelect = (id: string) => {
    setSelectedContactIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedContactIds.size === contacts.length) {
      setSelectedContactIds(new Set());
    } else {
      setSelectedContactIds(new Set(contacts.map((c) => c.id)));
    }
  };

  const handleSelectOverdueOnly = () => {
    const overdueIds = contacts.filter((c) => c.hours_without_activity > 24).map((c) => c.id);
    setSelectedContactIds(new Set(overdueIds));
  };

  const handleSelectUnassignedOnly = () => {
    const unassignedIds = contacts.filter((c) => !c.hubspot_owner_id || c.hubspot_owner_id.trim() === '').map((c) => c.id);
    setSelectedContactIds(new Set(unassignedIds));
  };

  const handleSelectHighPriorityOnly = () => {
    const highPriorityIds = contacts.filter((c) => c.priority === 'URGENT' || c.priority === 'HIGH').map((c) => c.id);
    setSelectedContactIds(new Set(highPriorityIds));
  };

  // Check which bulk action fields are configured
  const configuredChangesList = useMemo(() => {
    const list: { label: string; value: string; isClear?: boolean }[] = [];

    // 1. Asesor
    if (clearFields.owner || actionPayload.targetOwnerId === '__UNASSIGN__') {
      list.push({ label: 'Asesor / Cartera', value: '⚠️ Desasignar (Dejar en Nulo / Sin asesor)', isClear: true });
    } else if (actionPayload.targetOwnerId && actionPayload.targetOwnerId !== '') {
      const owner = owners.find((o) => o.id === actionPayload.targetOwnerId);
      list.push({ label: 'Asesor / Cartera', value: owner ? `${owner.firstName} ${owner.lastName}` : actionPayload.targetOwnerId });
    }

    // 2. Estado
    if (actionPayload.targetLeadStatus && actionPayload.targetLeadStatus !== '') {
      list.push({
        label: 'Estado',
        value: LEAD_STATUS_LABELS[actionPayload.targetLeadStatus as LeadStatus]?.label || actionPayload.targetLeadStatus,
      });
    }

    // 3. Ciclo de Vida
    if (actionPayload.targetLifecycleStage && actionPayload.targetLifecycleStage !== '') {
      list.push({
        label: 'Ciclo de Vida',
        value: LIFECYCLE_LABELS[actionPayload.targetLifecycleStage as LifecycleStage] || actionPayload.targetLifecycleStage,
      });
    }

    // 4. Prioridad
    if (clearFields.priority) {
      list.push({ label: 'Prioridad', value: '🗑️ Poner en NULO / Vacío (Sin Prioridad)', isClear: true });
    } else if (actionPayload.targetPriority && actionPayload.targetPriority !== '') {
      list.push({
        label: 'Prioridad',
        value: PRIORITY_LABELS[actionPayload.targetPriority as PriorityLevel]?.label || actionPayload.targetPriority,
      });
    }

    // 5. Campaña
    if (clearFields.campaign) {
      list.push({ label: 'Campaña UTM', value: '🗑️ Poner en NULO / Vacío (Borrar campaña)', isClear: true });
    } else if (actionPayload.targetCampaign !== undefined && actionPayload.targetCampaign.trim() !== '') {
      list.push({ label: 'Campaña UTM', value: actionPayload.targetCampaign.trim() });
    }

    // 6. Canal
    if (clearFields.source) {
      list.push({ label: 'Canal / Fuente', value: '🗑️ Poner en NULO / Vacío (Borrar canal)', isClear: true });
    } else if (actionPayload.targetSource && actionPayload.targetSource !== '') {
      list.push({ label: 'Canal / Fuente', value: actionPayload.targetSource });
    }

    // 7. Industria
    if (clearFields.industry) {
      list.push({ label: 'Industria', value: '🗑️ Poner en NULO / Vacío (Borrar industria)', isClear: true });
    } else if (actionPayload.targetIndustry && actionPayload.targetIndustry !== '') {
      list.push({ label: 'Industria', value: actionPayload.targetIndustry });
    }

    // 8. Ciudad
    if (clearFields.city) {
      list.push({ label: 'Ciudad', value: '🗑️ Poner en NULO / Vacío (Borrar ciudad)', isClear: true });
    } else if (actionPayload.targetCity !== undefined && actionPayload.targetCity.trim() !== '') {
      list.push({ label: 'Ciudad', value: actionPayload.targetCity.trim() });
    }

    // 9. Propiedades Adicionales
    customPropertiesToEdit.forEach((item) => {
      if (!item.propertyName) return;
      const propDef = availableProperties.find((p) => p.name === item.propertyName);
      const label = propDef ? propDef.label : item.propertyName;

      if (item.isNullOrEmpty) {
        list.push({
          label: propDef?.isCustom ? `[Personalizada] ${label}` : label,
          value: `🗑️ Poner en NULO / Vacío [${item.propertyName}]`,
          isClear: true,
        });
      } else if (item.value !== '') {
        let displayVal = item.value;
        if (propDef?.options) {
          const opt = propDef.options.find((o) => o.value === item.value);
          if (opt) displayVal = `${opt.label} (${item.value})`;
        }
        list.push({
          label: propDef?.isCustom ? `[Personalizada] ${label}` : label,
          value: `${displayVal} [${item.propertyName}]`,
        });
      }
    });

    return list;
  }, [actionPayload, clearFields, owners, customPropertiesToEdit, availableProperties]);

  const hasChangesConfigured = configuredChangesList.length > 0;

  // Active search/filter criteria descriptions for user awareness and warnings
  const activeFilterDescriptions = useMemo(() => {
    const desc: { label: string; value: string }[] = [];
    if (filters.searchKeyword && filters.searchKeyword.trim()) {
      desc.push({ label: 'Texto / Búsqueda', value: `"${filters.searchKeyword.trim()}"` });
    }
    if (filters.ownerId && filters.ownerId !== 'ALL') {
      if (filters.ownerId === '__UNASSIGNED__') {
        desc.push({ label: 'Asesor', value: 'Sin asesor (Cartera Libre)' });
      } else {
        const o = owners.find((own) => own.id === filters.ownerId);
        desc.push({ label: 'Asesor', value: o ? `${o.firstName} ${o.lastName}` : filters.ownerId });
      }
    }
    if (filters.leadStatus && filters.leadStatus !== 'ALL') {
      desc.push({ label: 'Estado del Lead', value: LEAD_STATUS_LABELS[filters.leadStatus as LeadStatus]?.label || filters.leadStatus });
    }
    if (filters.lifecycleStage && filters.lifecycleStage !== 'ALL') {
      desc.push({ label: 'Etapa del Ciclo', value: LIFECYCLE_LABELS[filters.lifecycleStage as LifecycleStage] || filters.lifecycleStage });
    }
    if (filters.priority && filters.priority !== 'ALL') {
      desc.push({ label: 'Prioridad', value: PRIORITY_LABELS[filters.priority as PriorityLevel]?.label || filters.priority });
    }
    if (filters.inactivityRange && filters.inactivityRange !== 'ALL') {
      const map: Record<string, string> = {
        overdue_24h: '🚨 SLA Vencido (> 24h)',
        overdue_48h: '⚠️ Riesgo Alto (> 48h)',
        overdue_7d: '⛔ Desatendidos (> 7d)',
        recent_12h: '⚡ Actividad Reciente (< 12h)',
      };
      desc.push({ label: 'Inactividad Comercial', value: map[filters.inactivityRange] || filters.inactivityRange });
    }
    if (filters.campaign && filters.campaign !== 'ALL') {
      desc.push({ label: 'Campaña UTM', value: filters.campaign });
    }
    if (filters.source && filters.source !== 'ALL') {
      desc.push({ label: 'Canal / Fuente', value: filters.source });
    }
    if (filters.industry && filters.industry !== 'ALL') {
      desc.push({ label: 'Industria', value: filters.industry });
    }
    if (filters.dateRange && filters.dateRange !== 'ALL') {
      const dateMap: Record<string, string> = {
        last_365d: 'Último Año (365 Días)',
        today: 'Registrados Hoy',
        last_7d: 'Últimos 7 Días',
        last_30d: 'Últimos 30 Días',
      };
      desc.push({ label: 'Fecha Creación', value: dateMap[filters.dateRange] || filters.dateRange });
    }
    return desc;
  }, [filters, owners]);

  // True if user is executing bulk update directly from filter criteria without previewing / selecting rows in table
  const isUpdatingByFilterCriteriaDirectly = !hasSearched || selectedContactIds.size === 0;

  // Execute Bulk Action with MCP
  const handleExecuteBatch = async () => {
    if (confirmKeyword.trim().toUpperCase() !== 'ACTUALIZAR') return;
    setIsConfirmModalOpen(false);
    setConfirmKeyword('');
    setIsExecuting(true);
    setExecutionComplete(false);
    const startTime = new Date();

    let idsToUpdate = Array.from(selectedContactIds);

    // If updating directly by search criteria (without prior table selection or preview)
    if (idsToUpdate.length === 0) {
      setExecutionProgress({
        current: 0,
        total: 0,
        pct: 0,
        statusText: 'Consultando en HubSpot CRM leads que coincidan con los criterios de búsqueda...',
        log: [],
      });

      try {
        const criteria: FilterCriteria = {
          ...filters,
          extraProperties: visibleCustomColumnNames,
        };
        const matching = await mcpHubspot.hubspot_search_contacts(criteria);
        if (!matching || matching.length === 0) {
          setIsExecuting(false);
          setExecutionComplete(true);
          setExecutionProgress({
            current: 0,
            total: 0,
            pct: 100,
            statusText: 'No se encontraron contactos en HubSpot que coincidan con los criterios de búsqueda configurados.',
            log: [],
          });
          return;
        }

        idsToUpdate = matching.map((c) => c.id);
        setContacts(matching);
        setSelectedContactIds(new Set(idsToUpdate));
        setHasSearched(true);
      } catch (err: any) {
        setIsExecuting(false);
        setExecutionComplete(true);
        setExecutionProgress({
          current: 0,
          total: 0,
          pct: 0,
          statusText: `Error al consultar contactos por criterios: ${err?.message || 'Error desconocido'}`,
          log: [],
        });
        return;
      }
    }

    const totalBatches = executionStrategy === 'batch_chunks' ? Math.ceil(idsToUpdate.length / 100) : idsToUpdate.length;
    setExecutionProgress({
      current: 0,
      total: idsToUpdate.length,
      pct: 0,
      currentBatch: 1,
      totalBatches,
      statusText:
        executionStrategy === 'batch_chunks'
          ? `Iniciando partición en ${totalBatches} lote(s) de máx 100 leads...`
          : `Iniciando actualización individual para ${idsToUpdate.length} leads...`,
      log: [],
    });

    const executionLog: { id: string; contactId: string; success: boolean; time: string; status?: string }[] = [];

    const clearPropsList: string[] = [];
    if (clearFields.owner || actionPayload.targetOwnerId === '__UNASSIGN__') clearPropsList.push('hubspot_owner_id');
    if (clearFields.campaign) clearPropsList.push('utm_campaign');
    if (clearFields.source) clearPropsList.push('utm_source');
    if (clearFields.priority) clearPropsList.push('hs_priority');
    if (clearFields.industry) clearPropsList.push('industry');
    if (clearFields.city) clearPropsList.push('city');

    const customPropsMap: Record<string, string> = {};
    customPropertiesToEdit.forEach((item) => {
      if (item.propertyName) {
        if (item.isNullOrEmpty) {
          customPropsMap[item.propertyName] = '__CLEAR__';
          clearPropsList.push(item.propertyName);
        } else if (item.value !== '') {
          customPropsMap[item.propertyName] = item.value;
        }
      }
    });

    const payloadWithCustom: BulkActionPayload = {
      ...actionPayload,
      targetOwnerId: clearFields.owner ? '__UNASSIGN__' : actionPayload.targetOwnerId,
      targetCampaign: clearFields.campaign ? '__CLEAR__' : actionPayload.targetCampaign,
      targetSource: clearFields.source ? '__CLEAR__' : actionPayload.targetSource,
      targetPriority: clearFields.priority ? '__CLEAR__' : actionPayload.targetPriority,
      targetIndustry: clearFields.industry ? '__CLEAR__' : actionPayload.targetIndustry,
      targetCity: clearFields.city ? '__CLEAR__' : actionPayload.targetCity,
      customProperties: customPropsMap,
      clearProperties: clearPropsList,
    };

    await mcpHubspot.hubspot_batch_update_contacts(
      idsToUpdate,
      payloadWithCustom,
      (current, total, contactId, success, batchMeta) => {
        executionLog.push({
          id: Math.random().toString(36).substring(2, 7),
          contactId,
          success,
          time: new Date().toLocaleTimeString(),
          status: batchMeta?.statusText || (success ? 'OK' : 'ERROR'),
        });

        setExecutionProgress({
          current,
          total,
          pct: Math.round((current / total) * 100),
          currentBatch: batchMeta?.chunkIndex || 1,
          totalBatches: batchMeta?.totalChunks || totalBatches,
          statusText: batchMeta?.statusText || `Procesando contacto ${current} de ${total}`,
          log: [...executionLog],
        });
      },
      executionStrategy,
    );

    const endTime = new Date();
    const failedCount = executionLog.filter((l) => !l.success).length;
    const activeUsername = userName || user?.email || 'Usuario de Sesión';
    const rawClientId = company?.client_id ?? company?.id ?? 1;
    const activeClientId = typeof rawClientId === 'number' ? rawClientId : parseInt(String(rawClientId), 10) || 1;

    try {
      const recorded = await bulkHistoryService.recordJob({
        clientId: activeClientId,
        executedByUsername: activeUsername,
        executedByUserId: user?.id,
        executionMode: idsToUpdate.length === 1 ? 'individual' : (executionStrategy === 'batch_chunks' ? 'lote' : 'individual'),
        status: failedCount === 0 ? 'completado' : (failedCount === idsToUpdate.length ? 'fallido' : 'parcialmente_fallido'),
        totalTargetRecords: idsToUpdate.length,
        successfulRecords: idsToUpdate.length - failedCount,
        failedRecords: failedCount,
        batchCount: totalBatches,
        startedAt: startTime.toISOString(),
        finishedAt: endTime.toISOString(),
        durationMs: endTime.getTime() - startTime.getTime(),
        filterCriteria: activeFilterDescriptions,
        appliedChanges: configuredChangesList,
        items: idsToUpdate.map((cid, idx) => {
          const contact = contacts.find((c) => c.id === cid);
          const logEntry = executionLog.find((l) => l.contactId === cid);
          const isItemSuccess = logEntry ? logEntry.success : true;
          return {
            id: `item-${Date.now()}-${idx}`,
            jobId: '',
            clientId: activeClientId,
            recordId: cid,
            recordIdentifier: contact
              ? `${contact.firstname || ''} ${contact.lastname || ''} (${contact.company || contact.email || 'Lead'})`.trim()
              : `Contacto #${cid}`,
            status: isItemSuccess ? 'exitoso' : 'fallido',
            batchChunkIndex: Math.floor(idx / 100) + 1,
            httpStatusCode: isItemSuccess ? 200 : 400,
            errorMessage: !isItemSuccess ? (logEntry?.status || 'Error al actualizar contacto') : undefined,
            appliedValues: payloadWithCustom,
            executedAt: new Date().toISOString(),
          };
        }),
      });
      setLastJobId(recorded.id);
    } catch (e) {
      console.warn('Could not record bulk job in history service:', e);
    }

    setIsExecuting(false);
    setExecutionComplete(true);
    setResultsActiveTab('current');

    // Refresh contact list and notify parent
    await fetchContacts(filters);
    if (onDataModified) {
      onDataModified();
    }
  };

  const getOwnerName = (ownerId: string) => {
    if (!ownerId || ownerId.trim() === '') {
      return 'Sin Asignar (Libre)';
    }
    const owner = owners.find((o) => o.id === ownerId);
    return owner ? `${owner.firstName} ${owner.lastName}` : 'Sin Asignar';
  };

  const resetAllFilters = () => {
    const defaultFilters: FilterCriteria = {
      ownerId: 'ALL',
      leadStatus: 'ALL',
      lifecycleStage: 'ALL',
      campaign: 'ALL',
      source: 'ALL',
      priority: 'ALL',
      industry: 'ALL',
      inactivityRange: 'ALL',
      dateRange: 'last_365d',
      searchKeyword: '',
    };
    setFilters(defaultFilters);
    if (hasSearched) {
      fetchContacts(defaultFilters);
    }
  };

  const clearBulkActionPayload = () => {
    setActionPayload({
      targetOwnerId: '',
      targetLeadStatus: '',
      targetLifecycleStage: '',
      targetCampaign: '',
      targetSource: '',
      targetPriority: '',
      targetIndustry: '',
      targetCity: '',
    });
    setClearFields({});
    setCustomPropertiesToEdit([]);
  };

  return (
    <div className="space-y-6" id="bulk-lead-manager-container">
      {/* Header Banner */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md bg-indigo-50 text-indigo-700 text-xs font-semibold uppercase tracking-wider mb-2">
            <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
            Productividad Comercial &amp; Gestión Masiva
          </div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">
            Gestión y Modificación Masiva de Leads en HubSpot CRM
          </h2>
          <p className="text-sm text-slate-600 mt-0.5">
            Filtra por todos los criterios admitidos en el CRM (asesor, estados, SLA, fechas, origen, prioridad, sector) y ejecuta actualizaciones masivas con protección de cuota API.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div className="bg-slate-50 border border-slate-200 px-4 py-2 rounded-lg text-right">
            <span className="text-xs text-slate-500 font-medium block">Leads Encontrados</span>
            <span className="text-lg font-bold text-slate-900">
              {hasSearched ? contacts.length : '—'}
            </span>
          </div>
          <div className="bg-indigo-50 border border-indigo-200 px-4 py-2 rounded-lg text-right">
            <span className="text-xs text-indigo-600 font-medium block">Seleccionados</span>
            <span className="text-lg font-bold text-indigo-700">
              {hasSearched ? selectedContactIds.size : '—'}
            </span>
          </div>
        </div>
      </div>

      {/* Multi-Criteria Filter Section (Origen) */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs" id="filter-origin-panel">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 mb-4 border-b border-slate-100 gap-2">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-indigo-600" />
            <h3 className="text-sm font-semibold text-slate-900 uppercase tracking-wide">
              1. Filtros de Búsqueda y Segmentación (Origen)
            </h3>
            <span className="text-[11px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-medium">
              10 Criterios Disponibles
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 transition-colors cursor-pointer"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              {showAdvancedFilters ? 'Ocultar Filtros Secundarios' : 'Mostrar Todos los Filtros'}
              {showAdvancedFilters ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
            <button
              onClick={resetAllFilters}
              className="text-xs font-medium text-slate-500 hover:text-slate-800 flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <RefreshCw className="w-3 h-3" />
              Restablecer Filtros
            </button>
          </div>
        </div>

        {/* Primary Filters Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {/* Asesor / Propietario */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5 flex items-center gap-1">
              <UserCheck className="w-3.5 h-3.5 text-indigo-600" />
              Asesor Asignado
            </label>
            <select
              value={filters.ownerId}
              onChange={(e) => setFilters({ ...filters, ownerId: e.target.value })}
              className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="ALL">Todos los Asesores</option>
              <option value="__UNASSIGNED__">⚠️ Sin Asesor (Cartera Libre)</option>
              {owners.map((owner) => (
                <option key={owner.id} value={owner.id}>
                  {owner.firstName} {owner.lastName} ({owner.team})
                </option>
              ))}
            </select>
          </div>

          {/* Estado del Lead */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Estado del Lead (`hs_lead_status`)
            </label>
            <select
              value={filters.leadStatus}
              onChange={(e) => setFilters({ ...filters, leadStatus: e.target.value })}
              className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="ALL">Todos los Estados</option>
              {Object.entries(LEAD_STATUS_LABELS).map(([key, item]) => (
                <option key={key} value={key}>
                  {item.label} ({key})
                </option>
              ))}
            </select>
          </div>

          {/* Etapa del Ciclo de Vida */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Etapa del Ciclo (`lifecyclestage`)
            </label>
            <select
              value={filters.lifecycleStage}
              onChange={(e) => setFilters({ ...filters, lifecycleStage: e.target.value })}
              className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="ALL">Todas las Etapas</option>
              {Object.entries(LIFECYCLE_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          {/* Inactividad / Alerta SLA */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5 flex items-center gap-1">
              <Clock className="w-3.5 h-3.5 text-amber-600" />
              Inactividad & SLA
            </label>
            <select
              value={filters.inactivityRange || 'ALL'}
              onChange={(e) => setFilters({ ...filters, inactivityRange: e.target.value })}
              className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="ALL">Cualquier Inactividad</option>
              <option value="overdue_24h">🚨 SLA Vencido (&gt; 24h sin contacto)</option>
              <option value="overdue_48h">⚠️ Riesgo Alto (&gt; 48h sin contacto)</option>
              <option value="overdue_7d">⛔ Desatendidos (&gt; 7 días)</option>
              <option value="recent_12h">⚡ Actividad Reciente (&lt; 12h)</option>
            </select>
          </div>

          {/* Búsqueda por texto libre */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Búsqueda Rápida
            </label>
            <div className="relative">
              <input
                type="text"
                placeholder="Nombre, empresa, email, ciudad..."
                value={filters.searchKeyword}
                onChange={(e) => setFilters({ ...filters, searchKeyword: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && fetchContacts()}
                className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg pl-8 pr-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
            </div>
          </div>
        </div>

        {/* Secondary / Advanced Filters Row */}
        {showAdvancedFilters && (
          <div className="mt-3 pt-3 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 animate-in fade-in duration-150">
            {/* Campaña UTM */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Campaña (`utm_campaign`)
              </label>
              <select
                value={filters.campaign}
                onChange={(e) => setFilters({ ...filters, campaign: e.target.value })}
                className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="ALL">Todas las Campañas</option>
                {uniqueCampaigns.map((camp) => (
                  <option key={camp} value={camp}>
                    {camp}
                  </option>
                ))}
              </select>
            </div>

            {/* Canal / Fuente */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Canal / Fuente (`utm_source`)
              </label>
              <select
                value={filters.source || 'ALL'}
                onChange={(e) => setFilters({ ...filters, source: e.target.value })}
                className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="ALL">Todos los Canales</option>
                {uniqueSources.map((src) => (
                  <option key={src} value={src}>
                    {src}
                  </option>
                ))}
              </select>
            </div>

            {/* Prioridad Comercial */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5 flex items-center gap-1">
                <Flame className="w-3.5 h-3.5 text-rose-500" />
                Prioridad Comercial
              </label>
              <select
                value={filters.priority || 'ALL'}
                onChange={(e) => setFilters({ ...filters, priority: e.target.value })}
                className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="ALL">Todas las Prioridades</option>
                <option value="URGENT">🔥 Urgente</option>
                <option value="HIGH">⚡ Alta</option>
                <option value="MEDIUM">🔹 Media</option>
                <option value="LOW">⚪ Baja</option>
              </select>
            </div>

            {/* Industria / Sector */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5 flex items-center gap-1">
                <Building2 className="w-3.5 h-3.5 text-slate-500" />
                Industria / Sector
              </label>
              <select
                value={filters.industry || 'ALL'}
                onChange={(e) => setFilters({ ...filters, industry: e.target.value })}
                className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="ALL">Todas las Industrias</option>
                {INDUSTRY_OPTIONS.map((ind) => (
                  <option key={ind} value={ind}>
                    {ind}
                  </option>
                ))}
              </select>
            </div>

            {/* Fecha de Creación */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Fecha de Creación (`createdate`)
              </label>
              <select
                value={filters.dateRange || 'last_365d'}
                onChange={(e) => setFilters({ ...filters, dateRange: e.target.value })}
                className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="last_365d">Último Año (365 Días) [Por defecto]</option>
                <option value="ALL">Todo el Historial</option>
                <option value="today">Registrados Hoy</option>
                <option value="last_7d">Últimos 7 Días</option>
                <option value="last_30d">Últimos 30 Días</option>
              </select>
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-col sm:flex-row items-start sm:items-center justify-between pt-2 gap-3">
          <div className="text-xs text-slate-500 flex items-center gap-2">
            {!hasSearched ? (
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-md">
                <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                Presiona «Aplicar Filtros y Buscar» para cargar los leads
              </span>
            ) : (
              <span className="text-slate-600">
                Filtros sincronizados con <strong>HubSpot CRM</strong>
              </span>
            )}
          </div>
          <button
            onClick={() => fetchContacts()}
            disabled={isLoading}
            className={`inline-flex items-center gap-2 text-white text-xs font-bold px-6 py-2.5 rounded-lg shadow-sm transition-all disabled:opacity-50 cursor-pointer ${
              !hasSearched
                ? 'bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 ring-4 ring-indigo-200 shadow-md'
                : 'bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800'
            }`}
          >
            <Search className="w-4 h-4" />
            {isLoading ? 'Buscando en HubSpot CRM...' : '🔍 Aplicar Filtros y Buscar'}
          </button>
        </div>
      </div>

      {/* Salida de la Lista de Leads - Ancho Horizontal Completo */}
      <div className="w-full bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden" id="preview-table-card">
        <div className="p-4 border-b border-slate-100 flex flex-col xl:flex-row xl:items-center justify-between gap-3 bg-slate-50/60">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleSelectAll}
              disabled={!hasSearched || contacts.length === 0}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 hover:text-indigo-600 transition-colors bg-white px-2.5 py-1.5 rounded-md border border-slate-200 shadow-2xs disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {hasSearched && selectedContactIds.size === contacts.length && contacts.length > 0 ? (
                <CheckSquare className="w-3.5 h-3.5 text-indigo-600" />
              ) : (
                <Square className="w-3.5 h-3.5 text-slate-400" />
              )}
              <span>
                Todos ({hasSearched ? `${selectedContactIds.size}/${contacts.length}` : '0/0'})
              </span>
            </button>

            <button
              onClick={handleSelectOverdueOnly}
              disabled={!hasSearched || contacts.length === 0}
              className="text-[11px] font-medium text-rose-700 hover:bg-rose-50 bg-white px-2 py-1.5 rounded border border-rose-200 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              title="Seleccionar contactos con más de 24 horas sin atención"
            >
              🚨 Solo SLA Vencido
            </button>

            <button
              onClick={handleSelectUnassignedOnly}
              disabled={!hasSearched || contacts.length === 0}
              className="text-[11px] font-medium text-amber-700 hover:bg-amber-50 bg-white px-2 py-1.5 rounded border border-amber-200 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              title="Seleccionar contactos sin asesor comercial asignado"
            >
              👤 Solo Sin Asignar
            </button>

            <button
              onClick={handleSelectHighPriorityOnly}
              disabled={!hasSearched || contacts.length === 0}
              className="text-[11px] font-medium text-indigo-700 hover:bg-indigo-50 bg-white px-2 py-1.5 rounded border border-indigo-200 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              🔥 Solo Urgentes/Altas
            </button>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="text-xs text-slate-500 flex items-center gap-1.5 mr-1">
              <span className={`inline-block w-2 h-2 rounded-full ${hasSearched && selectedContactIds.size > 0 ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`} />
              <span className="font-medium">{hasSearched ? selectedContactIds.size : 0} seleccionados</span>
            </div>

            <button
              type="button"
              onClick={() => setIsColumnPickerOpen(true)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg border border-slate-200 shadow-2xs transition-all cursor-pointer"
              title="Configurar qué propiedades de HubSpot mostrar en las columnas"
            >
              <Columns className="w-3.5 h-3.5 text-indigo-600" />
              <span>Columnas</span>
              {visibleCustomColumnNames.length > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-indigo-100 text-indigo-700 font-bold text-[10px]">
                  {visibleCustomColumnNames.length}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setIsHistoryModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg border border-slate-200 shadow-2xs transition-all cursor-pointer"
              title="Ver y filtrar historial de actualizaciones masivas anteriores"
            >
              <History className="w-3.5 h-3.5 text-indigo-600" />
              <span>Historial</span>
            </button>

            <button
              type="button"
              onClick={() => setIsActionPanelPopupOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold rounded-lg border border-slate-300 transition-all cursor-pointer"
              title="Abrir formulario de modificaciones en ventana emergente"
            >
              <Maximize2 className="w-3.5 h-3.5 text-indigo-600" />
              <span>Ventana Emergente</span>
            </button>

            <a
              href="#bulk-action-panel"
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white text-xs font-bold rounded-lg shadow-xs transition-all cursor-pointer"
              title="Desplazarse a la tarjeta de modificaciones masivas ubicada abajo"
            >
              <ArrowDown className="w-3.5 h-3.5" />
              <span>Configurar Modificaciones Masivas (Abajo)</span>
            </a>
          </div>
        </div>

          {/* Active Custom Columns Bar */}
          {visibleCustomColumnNames.length > 0 && (
            <div className="px-4 py-2 bg-indigo-50/40 border-b border-indigo-100 flex items-center gap-1.5 flex-wrap text-[11px]">
              <span className="text-slate-500 font-medium flex items-center gap-1">
                <Eye className="w-3 h-3 text-indigo-600" />
                Columnas CRM activas:
              </span>
              {visibleCustomColumnNames.map((colName) => {
                const propDef = availableProperties.find((p) => p.name === colName);
                return (
                  <span
                    key={colName}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white border border-indigo-200 text-slate-700 font-medium shadow-2xs text-[11px]"
                  >
                    {propDef?.isCustom && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" title="Propiedad personalizada" />}
                    <span>{propDef ? propDef.label : colName}</span>
                    <button
                      type="button"
                      onClick={() => handleToggleColumn(colName)}
                      className="text-slate-400 hover:text-rose-600 ml-0.5 p-0.5 rounded transition-colors cursor-pointer"
                      title={`Ocultar columna ${propDef?.label || colName}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                );
              })}
              <button
                type="button"
                onClick={() => setIsColumnPickerOpen(true)}
                className="text-indigo-600 hover:text-indigo-800 text-[11px] font-semibold flex items-center gap-0.5 ml-1 cursor-pointer"
              >
                <Plus className="w-3 h-3" />
                <span>Agregar Columna</span>
              </button>
            </div>
          )}

          <div className="overflow-x-auto max-h-[580px]">
            {isLoading ? (
              <div className="py-20 text-center">
                <div className="inline-block w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin mb-3" />
                <h4 className="text-sm font-semibold text-slate-800">Consultando HubSpot CRM...</h4>
                <p className="text-xs text-slate-500 mt-1">
                  Obteniendo contactos que coinciden con los criterios...
                </p>
              </div>
            ) : !hasSearched ? (
              <div className="py-16 px-6 text-center max-w-lg mx-auto">
                <div className="w-16 h-16 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center mx-auto mb-4 text-indigo-600 shadow-2xs">
                  <Search className="w-8 h-8 text-indigo-600" />
                </div>
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-800 text-[11px] font-semibold mb-3">
                  <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                  <span>Búsqueda bajo demanda</span>
                </div>
                <h4 className="text-base font-bold text-slate-800">
                  Haz clic en «Aplicar Filtros y Buscar» para ver los leads
                </h4>
                <p className="text-xs text-slate-600 mt-2 leading-relaxed">
                  Para optimizar las cuotas de tu API y acelerar la carga inicial, los contactos no se descargan automáticamente.
                </p>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  Configura tus filtros deseados en el panel superior (asesor, estado, SLA, campaña o industria) y pulsa el botón a continuación para encontrar y desplegar los leads.
                </p>
                <div className="mt-3 p-2 bg-indigo-50/70 border border-indigo-100 rounded-lg text-[11px] text-indigo-900 text-left flex items-start gap-2">
                  <Sparkles className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                  <span>
                    <strong>¿No necesitas ver los resultados antes?</strong> Puedes configurar los valores en el panel lateral derecho y pulsar <em>«Ejecutar Modificación Masiva»</em>. El sistema actualizará directamente todos los leads que cumplan los filtros actuales en HubSpot.
                  </span>
                </div>
                <div className="mt-5 flex flex-col sm:flex-row items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => fetchContacts()}
                    disabled={isLoading}
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl text-xs font-bold shadow-sm transition-all cursor-pointer disabled:opacity-50"
                  >
                    <Search className="w-4 h-4" />
                    {isLoading ? 'Consultando HubSpot...' : '🔍 Aplicar Filtros y Buscar Leads'}
                  </button>
                </div>
                <div className="mt-6 pt-4 border-t border-slate-100 grid grid-cols-3 gap-2 text-[10px] text-slate-500 text-left">
                  <div className="p-2 rounded-lg bg-slate-50 border border-slate-100">
                    <span className="font-semibold text-slate-700 block">1. Segmenta</span>
                    <span>Asesor, SLA, Estado...</span>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-50 border border-slate-100">
                    <span className="font-semibold text-slate-700 block">2. Consulta</span>
                    <span>Búsqueda en CRM</span>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-50 border border-slate-100">
                    <span className="font-semibold text-slate-700 block">3. Actualiza</span>
                    <span>Masivamente en lote</span>
                  </div>
                </div>
              </div>
            ) : contacts.length === 0 ? (
              <div className="p-12 text-center">
                <Users className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                <h4 className="text-sm font-semibold text-slate-700">No se encontraron leads con los filtros actuales</h4>
                <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                  {mcpHubspot.isConnectedToRealCRM()
                    ? 'No hay registros en tu portal HubSpot que coincidan con esta combinación de filtros. Puedes restablecerlos para ver toda tu cartera.'
                    : 'Intenta relajar los filtros de búsqueda o pulsar el botón a continuación para limpiar la vista.'}
                </p>
                <button
                  onClick={resetAllFilters}
                  className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Ver todos los contactos sin filtros
                </button>
              </div>
            ) : (
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold uppercase tracking-wider text-[11px] sticky top-0 z-10">
                    <th className="py-2.5 px-3 w-10 text-center">#</th>
                    <th className="py-2.5 px-3">Contacto / Empresa</th>
                    <th className="py-2.5 px-3">Asesor Actual</th>
                    <th className="py-2.5 px-3">Estado & Prioridad</th>
                    <th className="py-2.5 px-3">Etapa & Origen</th>
                    <th className="py-2.5 px-3">Inactividad</th>
                    {visibleCustomColumnNames.map((colName) => {
                      const propDef = availableProperties.find((p) => p.name === colName);
                      return (
                        <th
                          key={colName}
                          className="py-2.5 px-3 whitespace-nowrap bg-indigo-50/70 text-indigo-950 border-l border-indigo-100"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex flex-col">
                              <span className="font-semibold text-xs flex items-center gap-1 text-slate-800">
                                {propDef ? propDef.label : colName}
                                {propDef?.isCustom && (
                                  <span className="text-[8px] bg-emerald-100 text-emerald-800 px-1 py-0.2 rounded font-bold uppercase tracking-tight">
                                    Custom
                                  </span>
                                )}
                              </span>
                              <span className="font-mono text-[9px] text-slate-400 font-normal lowercase tracking-normal">
                                {colName}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleColumn(colName);
                              }}
                              className="text-slate-400 hover:text-rose-600 p-0.5 rounded hover:bg-white cursor-pointer transition-colors"
                              title={`Ocultar columna ${propDef?.label || colName}`}
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {contacts.map((contact) => {
                    const isSelected = selectedContactIds.has(contact.id);
                    const statusInfo = LEAD_STATUS_LABELS[contact.hs_lead_status] || {
                      label: contact.hs_lead_status,
                      color: 'bg-slate-100 text-slate-700 border-slate-200',
                    };
                    const priorityInfo = contact.priority ? PRIORITY_LABELS[contact.priority] : null;
                    const isOverdue = contact.hours_without_activity > 24;
                    const hasNoOwner = !contact.hubspot_owner_id || contact.hubspot_owner_id.trim() === '';

                    return (
                      <tr
                        key={contact.id}
                        onClick={() => handleToggleSelect(contact.id)}
                        className={`cursor-pointer transition-colors ${
                          isSelected ? 'bg-indigo-50/40 hover:bg-indigo-50/70' : 'hover:bg-slate-50'
                        }`}
                      >
                        <td className="py-3 px-3 text-center" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleToggleSelect(contact.id)}
                            className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                          />
                        </td>
                        <td className="py-3 px-3">
                          <div className="font-semibold text-slate-900">
                            {contact.firstname} {contact.lastname}
                          </div>
                          <div className="text-slate-500 text-[11px] truncate max-w-[170px]">{contact.email}</div>
                          <div className="text-slate-600 font-medium text-[11px] flex items-center gap-1 mt-0.5">
                            <Briefcase className="w-3 h-3 text-slate-400 shrink-0" />
                            <span className="truncate max-w-[160px]">{contact.company}</span>
                          </div>
                          {contact.city && (
                            <div className="text-slate-400 text-[10px] flex items-center gap-1 mt-0.5">
                              <MapPin className="w-2.5 h-2.5 text-slate-400" />
                              {contact.city}{contact.country ? `, ${contact.country}` : ''}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-3">
                          {hasNoOwner ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-50 text-rose-700 font-medium text-[11px] border border-rose-200">
                              <UserX className="w-3 h-3 text-rose-500" />
                              Sin Asignar
                            </span>
                          ) : (
                            <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-slate-100 text-slate-800 font-medium text-[11px]">
                              <UserCheck className="w-3 h-3 text-indigo-600" />
                              <span className="truncate max-w-[120px]">{getOwnerName(contact.hubspot_owner_id)}</span>
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-3">
                          <div className="flex flex-col gap-1 items-start">
                            <span
                              className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold border ${statusInfo.color}`}
                            >
                              {statusInfo.label}
                            </span>
                            {priorityInfo && (
                              <span
                                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${priorityInfo.color}`}
                              >
                                {contact.priority === 'URGENT' && <Flame className="w-2.5 h-2.5" />}
                                {priorityInfo.label}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          <div className="text-slate-800 font-medium truncate max-w-[130px]">
                            {LIFECYCLE_LABELS[contact.lifecyclestage] || contact.lifecyclestage}
                          </div>
                          {contact.utm_source && (
                            <div className="text-[10px] text-indigo-700 font-medium truncate max-w-[130px] mt-0.5">
                              {contact.utm_source}
                            </div>
                          )}
                          <div className="font-mono text-[9px] text-slate-400 truncate max-w-[130px]">
                            {contact.utm_campaign}
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          <div
                            className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded border ${
                              isOverdue
                                ? 'bg-rose-50 text-rose-700 border-rose-200'
                                : 'bg-slate-50 text-slate-600 border-slate-200'
                            }`}
                          >
                            <Clock className="w-3 h-3" />
                            {contact.hours_without_activity}h
                          </div>
                          {isOverdue && (
                            <div className="text-[10px] text-rose-600 font-medium mt-0.5">
                              SLA Vencido
                            </div>
                          )}
                        </td>
                        {/* Dynamic Custom Columns Content */}
                        {visibleCustomColumnNames.map((colName) => {
                          const propDef = availableProperties.find((p) => p.name === colName);
                          const rawVal = contact[colName];
                          const hasValue = rawVal !== undefined && rawVal !== null && rawVal !== '';
                          let displayNode: React.ReactNode = null;

                          if (!hasValue) {
                            displayNode = <span className="text-slate-300 font-mono text-[11px]">—</span>;
                          } else if (propDef?.options && propDef.options.length > 0) {
                            const matched = propDef.options.find((o) => o.value === String(rawVal));
                            displayNode = (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-50/90 text-indigo-800 border border-indigo-200/80 shadow-2xs">
                                <span>{matched ? matched.label : String(rawVal)}</span>
                              </span>
                            );
                          } else if (typeof rawVal === 'number' || (propDef?.type === 'number' && !isNaN(Number(rawVal)))) {
                            displayNode = (
                              <span className="font-mono text-slate-900 font-semibold text-[11px]">
                                {Number(rawVal).toLocaleString()}
                              </span>
                            );
                          } else if (rawVal === true || rawVal === 'true') {
                            displayNode = (
                              <span className="inline-flex items-center gap-1 text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded text-[10px] font-semibold border border-emerald-200">
                                Sí
                              </span>
                            );
                          } else if (rawVal === false || rawVal === 'false') {
                            displayNode = (
                              <span className="inline-flex items-center gap-1 text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded text-[10px] font-medium border border-slate-200">
                                No
                              </span>
                            );
                          } else {
                            displayNode = (
                              <span className="text-slate-800 font-medium text-[11px] truncate max-w-[140px] block" title={String(rawVal)}>
                                {String(rawVal)}
                              </span>
                            );
                          }

                          return (
                            <td key={colName} className="py-3 px-3 border-l border-indigo-50/60 bg-indigo-50/10">
                              {displayNode}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

      {/* 2. Tarjeta de Modificaciones Masivas - Ubicada DESPUÉS de la lista, a lo largo horizontalmente completo */}
      <div className="w-full mt-6 bg-white rounded-xl border border-slate-200 p-6 shadow-xs scroll-mt-24" id="bulk-action-panel">
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-100 flex-wrap gap-2">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-indigo-50 border border-indigo-100 text-indigo-600">
              <ArrowRightLeft className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">
                2. Configuración de Modificaciones Masivas (Destino)
              </h3>
              <p className="text-xs text-slate-500">
                Selecciona los campos a sobreescribir. Los campos en <span className="font-semibold text-slate-700">«-- Sin cambio --»</span> mantendrán su valor actual en HubSpot CRM.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsActionPanelPopupOpen(true)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 hover:text-indigo-600 bg-slate-50 hover:bg-slate-100 px-3 py-1.5 rounded-lg border border-slate-200 transition-colors cursor-pointer"
              title="Abrir formulario en ventana emergente"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              <span>Abrir en Ventana Emergente</span>
            </button>
            {hasChangesConfigured && (
              <button
                onClick={clearBulkActionPayload}
                className="text-xs font-medium text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 px-3 py-1.5 rounded-lg border border-rose-200 transition-colors cursor-pointer"
              >
                Restablecer campos
              </button>
            )}
          </div>
        </div>

        {/* 3-Column Responsive Grid across full width */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {/* Columna 1: Asignación y Ciclo de Vida */}
          <div className="space-y-3.5">
            <div className="pb-1.5 border-b border-slate-100 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                <UserCheck className="w-3.5 h-3.5 text-indigo-600" />
                1. Asignación y Ciclo Comercial
              </span>
            </div>

            {/* 1. Reasignar Asesor / Propietario */}
            <div className="p-2.5 rounded-lg border border-slate-200/80 bg-slate-50/40">
              <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center justify-between">
                <span className="flex items-center gap-1">
                  <UserCheck className="w-3.5 h-3.5 text-indigo-600" />
                  1. Reasignar Asesor / Cartera
                </span>
                <span className="text-[10px] font-mono text-slate-400">hubspot_owner_id</span>
              </label>
              <select
                disabled={Boolean(clearFields.owner)}
                value={clearFields.owner ? '__UNASSIGN__' : actionPayload.targetOwnerId || ''}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === '__UNASSIGN__') {
                    setClearFields((prev) => ({ ...prev, owner: true }));
                    setActionPayload({ ...actionPayload, targetOwnerId: '__UNASSIGN__' });
                  } else {
                    setClearFields((prev) => ({ ...prev, owner: false }));
                    setActionPayload({ ...actionPayload, targetOwnerId: val });
                  }
                }}
                className="w-full text-xs bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-amber-50 disabled:text-amber-900 disabled:border-amber-300"
              >
                <option value="">-- Sin cambio --</option>
                <option value="__UNASSIGN__">⚠️ Desasignar (Mover a Cartera Libre / Sin Asignar)</option>
                {owners.map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    Reasignar a: {owner.firstName} {owner.lastName} ({owner.team})
                  </option>
                ))}
              </select>
              <div className="mt-1.5 flex items-center justify-between">
                <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 font-medium cursor-pointer hover:text-slate-900 select-none">
                  <input
                    type="checkbox"
                    checked={Boolean(clearFields.owner || actionPayload.targetOwnerId === '__UNASSIGN__')}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setClearFields((prev) => ({ ...prev, owner: checked }));
                      setActionPayload((prev) => ({ ...prev, targetOwnerId: checked ? '__UNASSIGN__' : '' }));
                    }}
                    className="w-3.5 h-3.5 rounded text-amber-600 border-slate-300 focus:ring-amber-500 cursor-pointer"
                  />
                  <span className={clearFields.owner || actionPayload.targetOwnerId === '__UNASSIGN__' ? 'text-amber-800 font-semibold' : ''}>
                    Poner valor nulo / vaciar (desasignar asesor de todos los leads)
                  </span>
                </label>
              </div>
            </div>

            {/* 2. Cambiar Estado del Lead */}
            <div className="p-2.5 rounded-lg border border-slate-200/80 bg-slate-50/40">
              <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center justify-between">
                <span>2. Estado del Lead</span>
                <span className="text-[10px] font-mono text-slate-400">hs_lead_status</span>
              </label>
              <select
                value={actionPayload.targetLeadStatus || ''}
                onChange={(e) => setActionPayload({ ...actionPayload, targetLeadStatus: e.target.value })}
                className="w-full text-xs bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">-- Sin cambio --</option>
                {Object.entries(LEAD_STATUS_LABELS).map(([key, item]) => (
                  <option key={key} value={key}>
                    {item.label} ({key})
                  </option>
                ))}
              </select>
            </div>

            {/* 3. Cierre o Avance de Ciclo */}
            <div className="p-2.5 rounded-lg border border-slate-200/80 bg-slate-50/40">
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold text-slate-700">3. Etapa del Ciclo de Vida</label>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-slate-400 italic">Obligatoria en CRM (no permite nulo)</span>
                  <span className="text-[10px] font-mono text-slate-400">lifecyclestage</span>
                </div>
              </div>
              <select
                value={actionPayload.targetLifecycleStage || ''}
                onChange={(e) => setActionPayload({ ...actionPayload, targetLifecycleStage: e.target.value })}
                className="w-full text-xs bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">-- Sin cambio --</option>
                {Object.entries(LIFECYCLE_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Columna 2: Prioridad, Campaña y Segmento */}
          <div className="space-y-3.5">
            <div className="pb-1.5 border-b border-slate-100 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5 text-indigo-600" />
                2. Prioridad, Campaña y Segmento
              </span>
            </div>

            {/* 4. Prioridad Comercial */}
            <div className="p-2.5 rounded-lg border border-slate-200/80 bg-slate-50/40">
              <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center justify-between">
                <span className="flex items-center gap-1">
                  <Flame className="w-3.5 h-3.5 text-rose-500" />
                  4. Prioridad Comercial
                </span>
                <span className="text-[10px] font-mono text-slate-400">hs_priority</span>
              </label>
              <select
                disabled={Boolean(clearFields.priority)}
                value={clearFields.priority ? '' : actionPayload.targetPriority || ''}
                onChange={(e) => setActionPayload({ ...actionPayload, targetPriority: e.target.value })}
                className="w-full text-xs bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-amber-50 disabled:text-amber-800 disabled:border-amber-300"
              >
                <option value="">{clearFields.priority ? '-- Se enviará valor NULO / Vacío --' : '-- Sin cambio --'}</option>
                <option value="URGENT">🔥 Urgente (Atención Inmediata)</option>
                <option value="HIGH">⚡ Alta Prioridad</option>
                <option value="MEDIUM">🔹 Prioridad Media</option>
                <option value="LOW">⚪ Baja Prioridad</option>
              </select>
              <div className="mt-1.5 flex items-center justify-between">
                <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 font-medium cursor-pointer hover:text-slate-900 select-none">
                  <input
                    type="checkbox"
                    checked={Boolean(clearFields.priority)}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setClearFields((prev) => ({ ...prev, priority: checked }));
                      if (checked) {
                        setActionPayload((prev) => ({ ...prev, targetPriority: '' }));
                      }
                    }}
                    className="w-3.5 h-3.5 rounded text-amber-600 border-slate-300 focus:ring-amber-500 cursor-pointer"
                  />
                  <span className={clearFields.priority ? 'text-amber-800 font-semibold' : ''}>
                    Poner valor nulo / vacío (quitar prioridad en HubSpot)
                  </span>
                </label>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* 5. Cambio de Campaña */}
              <div className="p-2.5 rounded-lg border border-slate-200/80 bg-slate-50/40">
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-slate-700">
                    5. Campaña (`utm_campaign`)
                  </label>
                  {!clearFields.campaign && (
                    <button
                      type="button"
                      onClick={() => setIsManualCampaign((prev) => !prev)}
                      className="text-[10px] text-indigo-600 hover:text-indigo-800 font-semibold cursor-pointer underline flex items-center gap-0.5"
                    >
                      {isManualCampaign ? '📋 Elegir de la lista' : '✏️ Escribir manual'}
                    </button>
                  )}
                </div>

                {isManualCampaign ? (
                  <div className="relative">
                    <input
                      type="text"
                      list="bulk-campaign-suggestions"
                      disabled={Boolean(clearFields.campaign)}
                      placeholder={clearFields.campaign ? '⚠️ Se enviará valor NULO / Vacío a CRM' : 'Escribe o busca nombre de campaña...'}
                      value={clearFields.campaign ? '' : actionPayload.targetCampaign || ''}
                      onChange={(e) => setActionPayload({ ...actionPayload, targetCampaign: e.target.value })}
                      className="w-full text-xs bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-amber-50 disabled:text-amber-800 disabled:border-amber-300"
                    />
                    <datalist id="bulk-campaign-suggestions">
                      {uniqueCampaigns.map((camp) => (
                        <option key={camp} value={camp} />
                      ))}
                    </datalist>
                  </div>
                ) : (
                  <select
                    disabled={Boolean(clearFields.campaign)}
                    value={clearFields.campaign ? '' : actionPayload.targetCampaign || ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === '__MANUAL__') {
                        setIsManualCampaign(true);
                      } else {
                        setActionPayload({ ...actionPayload, targetCampaign: val });
                      }
                    }}
                    className="w-full text-xs bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-amber-50 disabled:text-amber-800 disabled:border-amber-300 font-medium"
                  >
                    <option value="">{clearFields.campaign ? '-- Se enviará valor NULO / Vacío --' : '-- Sin cambio --'}</option>
                    {uniqueCampaigns.map((camp) => (
                      <option key={camp} value={camp}>
                        {camp}
                      </option>
                    ))}
                    <option value="__MANUAL__">✏️ Escribir otra campaña personalizada...</option>
                  </select>
                )}

                <div className="mt-1.5">
                  <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 font-medium cursor-pointer hover:text-slate-900 select-none">
                    <input
                      type="checkbox"
                      checked={Boolean(clearFields.campaign)}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setClearFields((prev) => ({ ...prev, campaign: checked }));
                        if (checked) {
                          setActionPayload((prev) => ({ ...prev, targetCampaign: '' }));
                        }
                      }}
                      className="w-3.5 h-3.5 rounded text-amber-600 border-slate-300 focus:ring-amber-500 cursor-pointer"
                    />
                    <span className={clearFields.campaign ? 'text-amber-800 font-semibold' : ''}>
                      Poner valor nulo / vacío (borrar campaña en HubSpot)
                    </span>
                  </label>
                </div>
              </div>

              {/* 6. Canal / Fuente */}
              <div className="p-2.5 rounded-lg border border-slate-200/80 bg-slate-50/40">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  6. Canal (`utm_source`)
                </label>
                <select
                  disabled={Boolean(clearFields.source)}
                  value={clearFields.source ? '' : actionPayload.targetSource || ''}
                  onChange={(e) => setActionPayload({ ...actionPayload, targetSource: e.target.value })}
                  className="w-full text-xs bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-amber-50 disabled:text-amber-800 disabled:border-amber-300"
                >
                  <option value="">{clearFields.source ? '-- Se enviará valor NULO / Vacío --' : '-- Sin cambio --'}</option>
                  {SOURCE_OPTIONS.map((src) => (
                    <option key={src} value={src}>
                      {src}
                    </option>
                  ))}
                </select>
                <div className="mt-1.5">
                  <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 font-medium cursor-pointer hover:text-slate-900 select-none">
                    <input
                      type="checkbox"
                      checked={Boolean(clearFields.source)}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setClearFields((prev) => ({ ...prev, source: checked }));
                        if (checked) {
                          setActionPayload((prev) => ({ ...prev, targetSource: '' }));
                        }
                      }}
                      className="w-3.5 h-3.5 rounded text-amber-600 border-slate-300 focus:ring-amber-500 cursor-pointer"
                    />
                    <span className={clearFields.source ? 'text-amber-800 font-semibold' : ''}>
                      Poner valor nulo / vacío
                    </span>
                  </label>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* 7. Industria / Rubro */}
              <div className="p-2.5 rounded-lg border border-slate-200/80 bg-slate-50/40">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  7. Industria (`industry`)
                </label>
                <select
                  disabled={Boolean(clearFields.industry)}
                  value={clearFields.industry ? '' : actionPayload.targetIndustry || ''}
                  onChange={(e) => setActionPayload({ ...actionPayload, targetIndustry: e.target.value })}
                  className="w-full text-xs bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-amber-50 disabled:text-amber-800 disabled:border-amber-300"
                >
                  <option value="">{clearFields.industry ? '-- Se enviará valor NULO / Vacío --' : '-- Sin cambio --'}</option>
                  {INDUSTRY_OPTIONS.map((ind) => (
                    <option key={ind} value={ind}>
                      {ind}
                    </option>
                  ))}
                </select>
                <div className="mt-1.5">
                  <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 font-medium cursor-pointer hover:text-slate-900 select-none">
                    <input
                      type="checkbox"
                      checked={Boolean(clearFields.industry)}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setClearFields((prev) => ({ ...prev, industry: checked }));
                        if (checked) {
                          setActionPayload((prev) => ({ ...prev, targetIndustry: '' }));
                        }
                      }}
                      className="w-3.5 h-3.5 rounded text-amber-600 border-slate-300 focus:ring-amber-500 cursor-pointer"
                    />
                    <span className={clearFields.industry ? 'text-amber-800 font-semibold' : ''}>
                      Poner valor nulo / vacío
                    </span>
                  </label>
                </div>
              </div>

              {/* 8. Ciudad / Ubicación */}
              <div className="p-2.5 rounded-lg border border-slate-200/80 bg-slate-50/40">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  8. Ciudad (`city`)
                </label>
                <input
                  type="text"
                  disabled={Boolean(clearFields.city)}
                  placeholder={clearFields.city ? '⚠️ Se enviará valor NULO / Vacío a CRM' : 'Ej. Lima, Santiago...'}
                  value={clearFields.city ? '' : actionPayload.targetCity || ''}
                  onChange={(e) => setActionPayload({ ...actionPayload, targetCity: e.target.value })}
                  className="w-full text-xs bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-amber-50 disabled:text-amber-800 disabled:border-amber-300"
                />
                <div className="mt-1.5">
                  <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 font-medium cursor-pointer hover:text-slate-900 select-none">
                    <input
                      type="checkbox"
                      checked={Boolean(clearFields.city)}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setClearFields((prev) => ({ ...prev, city: checked }));
                        if (checked) {
                          setActionPayload((prev) => ({ ...prev, targetCity: '' }));
                        }
                      }}
                      className="w-3.5 h-3.5 rounded text-amber-600 border-slate-300 focus:ring-amber-500 cursor-pointer"
                    />
                    <span className={clearFields.city ? 'text-amber-800 font-semibold' : ''}>
                      Poner valor nulo / vacío
                    </span>
                  </label>
                </div>
              </div>
            </div>
          </div>

          {/* Columna 3: Propiedades Personalizadas y Campos del Portal */}
          <div className="space-y-3.5">
            <div className="pb-1.5 border-b border-slate-100 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5 text-indigo-600" />
                3. Propiedades Personalizadas
              </span>
            </div>

            {/* 9. Propiedades Dinámicas & Campos Personalizados del Portal */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                  <Database className="w-3.5 h-3.5 text-indigo-600" />
                  <span>Campos Personalizados del CRM</span>
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono bg-indigo-50 text-indigo-700 border border-indigo-200 px-1.5 py-0.5 rounded font-medium">
                    {availableProperties.length} en CRM
                  </span>
                  <button
                    type="button"
                    onClick={fetchProperties}
                    title="Sincronizar propiedades desde el portal de HubSpot"
                    className="text-[10px] text-indigo-600 hover:text-indigo-800 flex items-center gap-1 cursor-pointer font-medium"
                  >
                    <RefreshCw className={`w-3 h-3 ${isLoadingProperties ? 'animate-spin' : ''}`} />
                    <span>Sincronizar</span>
                  </button>
                </div>
              </div>

              <p className="text-[11px] text-slate-500 mb-3">
                Agrega cualquier propiedad estándar o personalizada propia de tu cuenta de HubSpot CRM para modificarla masivamente.
              </p>

              {/* Selector to add custom / dynamic property */}
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-2 mb-3">
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="relative flex-1">
                    <select
                      value={selectedPropertyToAdd}
                      onChange={(e) => setSelectedPropertyToAdd(e.target.value)}
                      className="w-full text-xs bg-white border border-slate-300 rounded-lg px-2.5 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="">-- Selecciona una propiedad para agregar --</option>
                      {/* Group 1: Custom Portal Properties */}
                      {availableProperties.filter((p) => p.isCustom).length > 0 && (
                        <optgroup label="⭐ Propiedades Personalizadas de tu Portal">
                          {availableProperties
                            .filter((p) => p.isCustom && !customPropertiesToEdit.some((c) => c.propertyName === p.name))
                            .map((p) => (
                              <option key={p.name} value={p.name}>
                                [Personalizada] {p.label} ({p.name})
                              </option>
                            ))}
                        </optgroup>
                      )}
                      {/* Group 2: All Other Standard Properties */}
                      <optgroup label="📋 Propiedades Estándar Disponibles">
                        {availableProperties
                          .filter((p) => !p.isCustom && !customPropertiesToEdit.some((c) => c.propertyName === p.name))
                          .map((p) => (
                            <option key={p.name} value={p.name}>
                              {p.label} ({p.name})
                            </option>
                          ))}
                      </optgroup>
                    </select>
                  </div>

                  <button
                    type="button"
                    disabled={!selectedPropertyToAdd}
                    onClick={() => {
                      if (!selectedPropertyToAdd) return;
                      setCustomPropertiesToEdit((prev) => [
                        ...prev,
                        { propertyName: selectedPropertyToAdd, value: '' },
                      ]);
                      setSelectedPropertyToAdd('');
                    }}
                    className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-colors shadow-xs shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Agregar Propiedad</span>
                  </button>
                </div>

                {/* Preview of options if property to add is selected */}
                {selectedPropertyToAdd && (() => {
                  const propToAddDef = availableProperties.find((p) => p.name === selectedPropertyToAdd);
                  if (!propToAddDef) return null;
                  const hasOpts = propToAddDef.options && propToAddDef.options.length > 0;
                  return (
                    <div className="p-2 bg-indigo-50/70 rounded-lg border border-indigo-100 text-[11px] text-indigo-950 flex flex-col gap-1">
                      <div className="flex items-center justify-between font-semibold">
                        <span className="flex items-center gap-1">
                          <Sparkles className="w-3 h-3 text-indigo-600" />
                          {propToAddDef.label} ({propToAddDef.name})
                        </span>
                        <span className="text-[10px] text-slate-500 font-mono">Tipo: {propToAddDef.type}</span>
                      </div>
                      {hasOpts ? (
                        <div className="text-[10px] text-slate-600">
                          <span className="font-semibold text-indigo-900">
                            Valores definidos en tu HubSpot ({propToAddDef.options?.length}):
                          </span>{' '}
                          {propToAddDef.options?.map((o) => o.label).slice(0, 6).join(', ')}
                          {(propToAddDef.options?.length || 0) > 6 ? ` y ${(propToAddDef.options?.length || 0) - 6} más...` : ''}
                        </div>
                      ) : (
                        <div className="text-[10px] text-slate-500">
                          Campo de entrada abierta (tipo {propToAddDef.type}).
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Quick Sugeridos Pills */}
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <span className="text-[10px] text-slate-400 font-medium">Sugeridas:</span>
                  {availableProperties
                    .filter((p) =>
                      [
                        'jobtitle',
                        'phone',
                        'website',
                        'country',
                        'motivo_contacto_personalizado',
                        'sucursal_asignada',
                        'monto_presupuesto_estimado',
                      ].includes(p.name),
                    )
                    .filter((p) => !customPropertiesToEdit.some((c) => c.propertyName === p.name))
                    .map((p) => (
                      <button
                        key={p.name}
                        type="button"
                        onClick={() => {
                          setCustomPropertiesToEdit((prev) => [
                            ...prev,
                            { propertyName: p.name, value: '' },
                          ]);
                        }}
                        className="text-[10px] px-2 py-0.5 rounded-full bg-white border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50 text-slate-700 font-medium flex items-center gap-1 cursor-pointer transition-all shadow-2xs"
                      >
                        {p.isCustom && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>}
                        <span>{p.label}</span>
                        <Plus className="w-2.5 h-2.5 text-slate-400" />
                      </button>
                    ))}
                </div>
              </div>

              {/* Configured Custom / Dynamic Properties List */}
              {customPropertiesToEdit.length > 0 ? (
                <div className="space-y-2.5 bg-indigo-50/50 p-3 rounded-lg border border-indigo-100 mb-3">
                  <div className="flex items-center justify-between text-[11px] font-semibold text-indigo-900 border-b border-indigo-100 pb-1.5">
                    <span className="flex items-center gap-1">
                      <Tag className="w-3 h-3 text-indigo-600" />
                      Propiedades adicionales activas para esta actualización ({customPropertiesToEdit.length}):
                    </span>
                    <button
                      type="button"
                      onClick={() => setCustomPropertiesToEdit([])}
                      className="text-[10px] text-rose-600 hover:text-rose-800 cursor-pointer font-medium"
                    >
                      Quitar todas
                    </button>
                  </div>

                  {customPropertiesToEdit.map((item, idx) => {
                    const propDef = availableProperties.find((p) => p.name === item.propertyName);
                    const hasOptions = propDef?.options && propDef.options.length > 0;
                    const isBool = propDef?.type === 'bool' || propDef?.fieldType === 'booleancheckbox';
                    const isNum = propDef?.type === 'number';
                    const isDate = propDef?.type === 'date' || propDef?.type === 'datetime';

                    return (
                      <div key={idx} className="bg-white p-2.5 rounded-lg border border-slate-200 shadow-2xs space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-xs font-bold text-slate-800">
                              {propDef ? propDef.label : item.propertyName}
                            </span>
                            <span className="font-mono text-[9px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                              {item.propertyName}
                            </span>
                            {propDef?.isCustom ? (
                              <span className="text-[9px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.2 rounded">
                                Personalizada
                              </span>
                            ) : (
                              <span className="text-[9px] font-medium text-slate-500 bg-slate-50 border border-slate-200 px-1.5 py-0.2 rounded">
                                Estándar
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setCustomPropertiesToEdit((prev) => prev.filter((_, i) => i !== idx));
                            }}
                            className="text-slate-400 hover:text-rose-600 p-1 rounded hover:bg-rose-50 cursor-pointer transition-colors"
                            title="Quitar este campo del lote"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        {/* Input customized to type and choices */}
                        {(() => {
                          const clearInfo = canPropertyBeCleared(item.propertyName);
                          const isCleared = Boolean(item.isNullOrEmpty);

                          return (
                            <div className="space-y-2">
                              {hasOptions ? (
                                <div className="space-y-2">
                                  <select
                                    disabled={isCleared}
                                    value={isCleared ? '' : item.value}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      setCustomPropertiesToEdit((prev) =>
                                        prev.map((c, i) => (i === idx ? { ...c, value: val, isNullOrEmpty: false } : c)),
                                      );
                                    }}
                                    className="w-full text-xs bg-slate-50 border border-slate-300 rounded-md px-2.5 py-1.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-amber-50 disabled:text-amber-800 disabled:border-amber-300"
                                  >
                                    <option value="">
                                      {isCleared
                                        ? '-- Se enviará valor NULO / Vacío a HubSpot --'
                                        : `-- Seleccionar valor para ${propDef?.label} --`}
                                    </option>
                                    {propDef?.options?.map((opt) => (
                                      <option key={opt.value} value={opt.value}>
                                        {opt.label} ({opt.value})
                                      </option>
                                    ))}
                                  </select>

                                  {/* Clickable pill options showing allowed values in HubSpot */}
                                  {!isCleared && propDef?.options && propDef.options.length > 0 && (
                                    <div className="bg-slate-50/90 p-2 rounded-lg border border-slate-200/90 space-y-1.5">
                                      <div className="flex items-center justify-between text-[10px] text-slate-500 font-medium">
                                        <span className="flex items-center gap-1 font-semibold text-indigo-900">
                                          <Sparkles className="w-3 h-3 text-indigo-600" />
                                          Valores permitidos en HubSpot ({propDef.options.length}):
                                        </span>
                                        <span className="text-slate-400">Clic para seleccionar</span>
                                      </div>
                                      <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto pr-1">
                                        {propDef.options.map((opt) => {
                                          const isSelected = item.value === opt.value;
                                          return (
                                            <button
                                              key={opt.value}
                                              type="button"
                                              onClick={() => {
                                                setCustomPropertiesToEdit((prev) =>
                                                  prev.map((c, i) => (i === idx ? { ...c, value: opt.value, isNullOrEmpty: false } : c)),
                                                );
                                              }}
                                              className={`text-[11px] px-2 py-1 rounded-md transition-all flex items-center gap-1.5 cursor-pointer border text-left ${
                                                isSelected
                                                  ? 'bg-indigo-600 text-white border-indigo-600 font-semibold shadow-xs'
                                                  : 'bg-white text-slate-700 border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/60'
                                              }`}
                                            >
                                              <span>{opt.label}</span>
                                              <span
                                                className={`font-mono text-[9px] ${
                                                  isSelected ? 'text-indigo-200' : 'text-slate-400'
                                                }`}
                                              >
                                                [{opt.value}]
                                              </span>
                                              {isSelected && <Check className="w-3 h-3 text-white ml-auto" />}
                                            </button>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              ) : isBool ? (
                                <select
                                  disabled={isCleared}
                                  value={isCleared ? '' : item.value}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setCustomPropertiesToEdit((prev) =>
                                      prev.map((c, i) => (i === idx ? { ...c, value: val, isNullOrEmpty: false } : c)),
                                    );
                                  }}
                                  className="w-full text-xs bg-slate-50 border border-slate-300 rounded-md px-2.5 py-1.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-amber-50 disabled:text-amber-800 disabled:border-amber-300"
                                >
                                  <option value="">
                                    {isCleared ? '-- Se enviará valor NULO / Vacío a HubSpot --' : '-- Sin cambio --'}
                                  </option>
                                  <option value="true">Verdadero / Sí (true)</option>
                                  <option value="false">Falso / No (false)</option>
                                </select>
                              ) : isNum ? (
                                <input
                                  type="number"
                                  disabled={isCleared}
                                  placeholder={
                                    isCleared
                                      ? '⚠️ Se enviará valor NULO / Vacío a HubSpot'
                                      : `Ingresa valor numérico para ${propDef ? propDef.label : item.propertyName}`
                                  }
                                  value={isCleared ? '' : item.value}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setCustomPropertiesToEdit((prev) =>
                                      prev.map((c, i) => (i === idx ? { ...c, value: val, isNullOrEmpty: false } : c)),
                                    );
                                  }}
                                  className="w-full text-xs bg-slate-50 border border-slate-300 rounded-md px-2.5 py-1.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-amber-50 disabled:text-amber-800 disabled:border-amber-300"
                                />
                              ) : isDate ? (
                                <input
                                  type="date"
                                  disabled={isCleared}
                                  value={isCleared ? '' : item.value}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setCustomPropertiesToEdit((prev) =>
                                      prev.map((c, i) => (i === idx ? { ...c, value: val, isNullOrEmpty: false } : c)),
                                    );
                                  }}
                                  className="w-full text-xs bg-slate-50 border border-slate-300 rounded-md px-2.5 py-1.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-amber-50 disabled:text-amber-800 disabled:border-amber-300"
                                />
                              ) : (
                                <input
                                  type="text"
                                  disabled={isCleared}
                                  placeholder={
                                    isCleared
                                      ? '⚠️ Se enviará valor NULO / Vacío a HubSpot'
                                      : `Nuevo valor para ${propDef ? propDef.label : item.propertyName}`
                                  }
                                  value={isCleared ? '' : item.value}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setCustomPropertiesToEdit((prev) =>
                                      prev.map((c, i) => (i === idx ? { ...c, value: val, isNullOrEmpty: false } : c)),
                                    );
                                  }}
                                  className="w-full text-xs bg-slate-50 border border-slate-300 rounded-md px-2.5 py-1.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-amber-50 disabled:text-amber-800 disabled:border-amber-300"
                                />
                              )}

                              {/* Checkbox for Null / Empty value */}
                              <div className="pt-1 flex items-center justify-between border-t border-slate-100">
                                {clearInfo.allowed ? (
                                  <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 font-medium cursor-pointer hover:text-slate-900 select-none">
                                    <input
                                      type="checkbox"
                                      checked={isCleared}
                                      onChange={(e) => {
                                        const checked = e.target.checked;
                                        setCustomPropertiesToEdit((prev) =>
                                          prev.map((c, i) =>
                                            i === idx
                                              ? {
                                                  ...c,
                                                  isNullOrEmpty: checked,
                                                  value: checked ? '' : c.value,
                                                }
                                              : c,
                                          ),
                                        );
                                      }}
                                      className="w-3.5 h-3.5 rounded text-amber-600 border-slate-300 focus:ring-amber-500 cursor-pointer"
                                    />
                                    <span className={isCleared ? 'text-amber-800 font-semibold' : ''}>
                                      Poner en valor nulo / vacío (borrar valor en HubSpot)
                                    </span>
                                  </label>
                                ) : (
                                  <span className="text-[10px] text-slate-400 italic">
                                    ⚠️ {clearInfo.reason}
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="p-3 rounded-lg border border-dashed border-slate-200 text-center text-slate-400 text-[11px] mb-3">
                  No hay propiedades adicionales agregadas. Puedes seleccionar cualquier campo de tu CRM en el menú superior.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Execution Strategy Selector */}
        <div className="mt-5 p-3.5 rounded-xl bg-slate-50 border border-slate-200">
          <label className="block text-xs font-semibold text-slate-800 mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-600" />
              Mecanismo de Ejecución:
            </span>
            <span className="text-[10px] font-mono text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded font-semibold">
              {executionStrategy === 'batch_chunks' ? 'Lotes Automáticos (100% de la Selección)' : 'Sincronización Individual'}
            </span>
          </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setExecutionStrategy('batch_chunks')}
                className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                  executionStrategy === 'batch_chunks'
                    ? 'bg-indigo-50/90 border-indigo-500 ring-1 ring-indigo-500 shadow-xs'
                    : 'bg-white border-slate-200 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center justify-between font-semibold text-xs text-slate-900">
                  <div className="flex items-center gap-1.5">
                    <Zap className={`w-3.5 h-3.5 ${executionStrategy === 'batch_chunks' ? 'text-indigo-600' : 'text-slate-400'}`} />
                    <span>Lotes Automáticos de CRM (hasta 100 c/u)</span>
                  </div>
                  <span className="text-[9px] bg-emerald-100 text-emerald-800 font-bold px-1.5 py-0.2 rounded-full uppercase tracking-tight">
                    Recomendado
                  </span>
                </div>
                <p className="text-[11px] text-slate-600 mt-1.5 leading-relaxed">
                  Actualiza <strong>el 100% de los leads seleccionados</strong> dividiéndolos automáticamente en bloques de hasta 100 por solicitud (límite oficial de la API de HubSpot).
                </p>
                <div className="mt-2 text-[10px] text-indigo-800 font-medium bg-white/80 p-1.5 rounded-md border border-indigo-100">
                  Ejemplo: si seleccionas 109 leads, se enviarán en <strong>2 lotes</strong> (100 + 9 leads) y <strong>los 109 quedan actualizados</strong>.
                </div>
              </button>

              <button
                type="button"
                onClick={() => setExecutionStrategy('mcp_individual_queue')}
                className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                  executionStrategy === 'mcp_individual_queue'
                    ? 'bg-indigo-50/90 border-indigo-500 ring-1 ring-indigo-500 shadow-xs'
                    : 'bg-white border-slate-200 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center justify-between font-semibold text-xs text-slate-900">
                  <div className="flex items-center gap-1.5">
                    <Layers className={`w-3.5 h-3.5 ${executionStrategy === 'mcp_individual_queue' ? 'text-indigo-600' : 'text-slate-400'}`} />
                    <span>Sincronización Individual (Contacto por Contacto)</span>
                  </div>
                  <span className="text-[9px] bg-slate-100 text-slate-600 font-semibold px-1.5 py-0.2 rounded">
                    1 a 1
                  </span>
                </div>
                <p className="text-[11px] text-slate-600 mt-1.5 leading-relaxed">
                  Actualiza cada contacto de forma individual y segura para aislar y reportar cualquier anomalía específica.
                </p>
                <div className="mt-2 text-[10px] text-slate-600 font-medium bg-white/80 p-1.5 rounded-md border border-slate-200">
                  Actualiza con verificación directa cada uno de los <strong>{selectedContactIds.size} leads seleccionados</strong>.
                </div>
              </button>
            </div>

            {/* Dynamic Batch Partition Simulator for current selection or search criteria */}
            {isUpdatingByFilterCriteriaDirectly ? (
              <div className="mt-3 p-2.5 bg-amber-50/80 rounded-lg border border-amber-300 text-[11px] flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-100 text-amber-800 font-bold text-xs">
                    ⚡
                  </span>
                  <div>
                    <span className="font-bold text-amber-950">
                      Cobertura total por criterios de búsqueda (Sin requerir ver resultados)
                    </span>
                    <p className="text-amber-800 text-[10px]">
                      {executionStrategy === 'batch_chunks'
                        ? 'Se localizarán en HubSpot todos los leads correspondientes y se actualizarán automáticamente en bloques de máx 100.'
                        : 'Se consultarán los leads según los filtros y se procesarán 1 a 1 con workers concurrentes.'}
                    </p>
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded-md bg-amber-100 border border-amber-300 text-amber-900 font-mono text-[10px] font-bold">
                  Búsqueda Directa CRM
                </span>
              </div>
            ) : selectedContactIds.size > 0 ? (
              <div className="mt-3 p-2.5 bg-white rounded-lg border border-slate-200 text-[11px] flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-100 text-emerald-700 font-bold text-xs">
                    ✓
                  </span>
                  <div>
                    <span className="font-bold text-slate-800">
                      Cobertura total garantizada: {selectedContactIds.size} de {selectedContactIds.size} leads seleccionados
                    </span>
                    <p className="text-slate-500 text-[10px]">
                      {executionStrategy === 'batch_chunks' ? (
                        <>
                          Se particionarán automáticamente en{' '}
                          <strong className="text-indigo-700 font-semibold">
                            {Math.ceil(selectedContactIds.size / 100)} lote(s)
                          </strong>{' '}
                          consecutivo(s)
                          {selectedContactIds.size > 100 && (
                            <>
                              {' '}
                              (Lote 1: 100 leads, Lote 2: {selectedContactIds.size - 100} leads)
                            </>
                          )}
                          . ¡Ningún lead queda por fuera!
                        </>
                      ) : (
                        <>
                          Se procesarán los {selectedContactIds.size} contactos uno tras otro con 2 workers en paralelo.
                        </>
                      )}
                    </p>
                  </div>
                </div>

                <span className="px-2 py-0.5 rounded-md bg-indigo-50 border border-indigo-200 text-indigo-700 font-mono text-[10px] font-bold">
                  {executionStrategy === 'batch_chunks'
                    ? `${Math.ceil(selectedContactIds.size / 100)} lote(s) de API`
                    : `${selectedContactIds.size} llamadas individuales`}
                </span>
              </div>
            ) : null}
          </div>

          {/* Action Impact Summary Box */}
          <div className="mt-4 p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600">
            <div className="font-semibold text-slate-800 mb-1.5 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5 text-indigo-600" />
                Resumen de Modificación Masiva
              </span>
              {isUpdatingByFilterCriteriaDirectly ? (
                <span className="font-bold text-[10px] text-amber-900 bg-amber-100 border border-amber-300 px-2 py-0.5 rounded-full flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-amber-600" />
                  Por Criterios de Filtro
                </span>
              ) : (
                <span className="font-bold text-indigo-700">{selectedContactIds.size} seleccionados</span>
              )}
            </div>

            {/* Warning banner when updating directly without viewing table results */}
            {isUpdatingByFilterCriteriaDirectly && (
              <div className="mt-2 mb-2.5 p-2.5 rounded-lg bg-amber-50 border border-amber-300 text-[11px] text-amber-950 space-y-1.5">
                <div className="flex items-center gap-1.5 font-bold text-amber-900 text-xs">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  <span>Sin previsualización en tabla</span>
                </div>
                <p className="text-amber-800 leading-relaxed text-[11px]">
                  No ver el resultado de los filtros no te restringe: se actualizarán masivamente todos los leads en HubSpot que cumplan los criterios de la búsqueda configurada.
                </p>
                {activeFilterDescriptions.length > 0 ? (
                  <div className="bg-white/90 p-2 rounded border border-amber-200 space-y-1">
                    <span className="font-semibold text-amber-900 text-[10px] uppercase tracking-wide block">
                      Criterios activos de búsqueda:
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {activeFilterDescriptions.map((c, i) => (
                        <span key={i} className="inline-flex items-center gap-1 bg-amber-50 border border-amber-200 text-amber-950 px-1.5 py-0.5 rounded text-[10px]">
                          <span className="text-amber-700">{c.label}:</span>
                          <strong>{c.value}</strong>
                        </span>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-[10px] text-amber-800 italic">
                    (Se aplicará a los contactos del CRM coincidentes según los filtros activos)
                  </p>
                )}
              </div>
            )}

            {hasChangesConfigured ? (
              <div className="space-y-1 mt-2">
                <span className="text-[11px] text-slate-500 font-medium block mb-1">
                  Propiedades a sincronizar en lote:
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {configuredChangesList.map((chg, idx) => (
                    <span
                      key={idx}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded font-medium text-[10px] border ${
                        chg.isClear
                          ? 'bg-amber-50 text-amber-800 border-amber-300 font-semibold'
                          : 'bg-indigo-50 text-indigo-700 border-indigo-200'
                      }`}
                    >
                      <span className="font-semibold">{chg.label}:</span>
                      <span>{chg.value}</span>
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-amber-700 font-medium mt-1">
                * Configura al menos una propiedad estándar o personalizada arriba para habilitar la ejecución en lote.
              </p>
            )}
          </div>

          {/* Submit Button */}
          <button
            onClick={() => {
              setConfirmKeyword('');
              setIsConfirmModalOpen(true);
            }}
            disabled={!hasChangesConfigured || isExecuting}
            className="w-full mt-4 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-semibold text-xs py-3 px-4 rounded-lg shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
          >
            <ArrowRightLeft className="w-4 h-4" />
            {isUpdatingByFilterCriteriaDirectly ? (
              <>⚡ Ejecutar Modificación Masiva por Criterios de Búsqueda</>
            ) : (
              <>⚡ Ejecutar Modificación Masiva ({selectedContactIds.size} Leads Seleccionados)</>
            )}
          </button>
        </div>

      {/* Barra flotante rápida para ir a Modificaciones o abrir Emergente */}
      {(selectedContactIds.size > 0 || isUpdatingByFilterCriteriaDirectly) && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-40 bg-slate-900/95 text-white px-5 py-2.5 rounded-full shadow-2xl border border-slate-700/80 backdrop-blur-md flex items-center gap-3 animate-in slide-in-from-bottom-4 duration-200">
          <div className="flex items-center gap-2 text-xs">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>
              {isUpdatingByFilterCriteriaDirectly ? (
                <strong>Modificación por Criterios de Búsqueda</strong>
              ) : (
                <><strong>{selectedContactIds.size}</strong> leads seleccionados</>
              )}
            </span>
          </div>
          <div className="h-4 w-px bg-slate-700" />
          <a
            href="#bulk-action-panel"
            className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold px-3 py-1 rounded-full transition-all flex items-center gap-1.5 cursor-pointer shadow-xs"
          >
            <span>Modificaciones Masivas</span>
            <ArrowDown className="w-3.5 h-3.5" />
          </a>
          <button
            onClick={() => setIsActionPanelPopupOpen(true)}
            className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium px-3 py-1 rounded-full border border-slate-600 transition-all flex items-center gap-1.5 cursor-pointer"
          >
            <Maximize2 className="w-3 h-3 text-slate-400" />
            <span>Emergente</span>
          </button>
        </div>
      )}

      {/* Column Customizer Modal */}
      {isColumnPickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-slate-200 flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2.5 text-indigo-700">
                <div className="p-2 rounded-lg bg-indigo-50 border border-indigo-100">
                  <Columns className="w-5 h-5 text-indigo-600" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Personalizar Columnas de Leads en la Tabla
                  </h3>
                  <p className="text-xs text-slate-500">
                    Elige qué propiedades de tu portal HubSpot deseas inspeccionar en la lista antes de actualizar masivamente
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsColumnPickerOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Search & Tabs */}
            <div className="pt-4 pb-2 space-y-3">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Buscar propiedades por etiqueta o nombre técnico (ej: motivo, ciudad, presupuesto...)"
                  value={columnSearchQuery}
                  onChange={(e) => setColumnSearchQuery(e.target.value)}
                  className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg pl-9 pr-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                {columnSearchQuery && (
                  <button
                    type="button"
                    onClick={() => setColumnSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs"
                  >
                    ×
                  </button>
                )}
              </div>

              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setColumnFilterTab('all')}
                    className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer ${
                      columnFilterTab === 'all'
                        ? 'bg-white text-indigo-700 shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Todas ({availableProperties.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setColumnFilterTab('custom')}
                    className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer flex items-center gap-1 ${
                      columnFilterTab === 'custom'
                        ? 'bg-white text-emerald-700 shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <span>⭐ Personalizadas</span>
                    <span className="text-[10px] bg-emerald-100 text-emerald-800 px-1.5 py-0.2 rounded-full">
                      {availableProperties.filter((p) => p.isCustom).length}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setColumnFilterTab('standard')}
                    className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer ${
                      columnFilterTab === 'standard'
                        ? 'bg-white text-slate-900 shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Estándar ({availableProperties.filter((p) => !p.isCustom).length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setColumnFilterTab('selected')}
                    className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer flex items-center gap-1 ${
                      columnFilterTab === 'selected'
                        ? 'bg-white text-indigo-700 shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <span>Activas</span>
                    <span className="text-[10px] bg-indigo-100 text-indigo-800 px-1.5 py-0.2 rounded-full font-bold">
                      {visibleCustomColumnNames.length}
                    </span>
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const allCustom = availableProperties.filter((p) => p.isCustom).map((p) => p.name);
                      const combined = Array.from(new Set([...visibleCustomColumnNames, ...allCustom]));
                      setVisibleCustomColumnNames(combined);
                      if (hasSearched) {
                        fetchContacts(filters, combined);
                      }
                    }}
                    className="text-[11px] font-semibold text-emerald-700 hover:text-emerald-800 cursor-pointer"
                  >
                    + Activar todas personalizadas
                  </button>
                  <span className="text-slate-300">|</span>
                  <button
                    type="button"
                    onClick={() => {
                      const defaultCols = [
                        'motivo_contacto_personalizado',
                        'sucursal_asignada',
                        'monto_presupuesto_estimado',
                      ];
                      setVisibleCustomColumnNames(defaultCols);
                      if (hasSearched) {
                        fetchContacts(filters, defaultCols);
                      }
                    }}
                    className="text-[11px] font-semibold text-slate-500 hover:text-slate-700 cursor-pointer"
                  >
                    Restablecer
                  </button>
                  <span className="text-slate-300">|</span>
                  <button
                    type="button"
                    onClick={() => {
                      setVisibleCustomColumnNames([]);
                      if (hasSearched) {
                        fetchContacts(filters, []);
                      }
                    }}
                    className="text-[11px] font-semibold text-rose-600 hover:text-rose-700 cursor-pointer"
                  >
                    Limpiar
                  </button>
                </div>
              </div>
            </div>

            {/* Properties List with Checkboxes */}
            <div className="flex-1 overflow-y-auto py-2 pr-1 space-y-1.5 max-h-[380px] border-t border-b border-slate-100">
              {availableProperties
                .filter((p) => {
                  if (columnFilterTab === 'custom') return p.isCustom;
                  if (columnFilterTab === 'standard') return !p.isCustom;
                  if (columnFilterTab === 'selected') return visibleCustomColumnNames.includes(p.name);
                  return true;
                })
                .filter((p) => {
                  if (!columnSearchQuery.trim()) return true;
                  const q = columnSearchQuery.toLowerCase();
                  return (
                    p.label.toLowerCase().includes(q) ||
                    p.name.toLowerCase().includes(q) ||
                    (p.description && p.description.toLowerCase().includes(q))
                  );
                })
                .map((p) => {
                  const isChecked = visibleCustomColumnNames.includes(p.name);
                  const hasOpts = p.options && p.options.length > 0;

                  return (
                    <label
                      key={p.name}
                      onClick={() => handleToggleColumn(p.name)}
                      className={`flex items-start justify-between p-2.5 rounded-xl border transition-all cursor-pointer select-none ${
                        isChecked
                          ? 'bg-indigo-50/50 border-indigo-200'
                          : 'bg-white border-slate-200 hover:bg-slate-50/80 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {}} // handled by wrapper
                          className="mt-1 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                        />
                        <div className="flex flex-col min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-semibold text-xs text-slate-800">{p.label}</span>
                            <span className="font-mono text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.2 rounded border border-slate-200">
                              {p.name}
                            </span>
                            {p.isCustom ? (
                              <span className="text-[9px] font-bold text-emerald-800 bg-emerald-100 border border-emerald-300 px-1.5 py-0.2 rounded-full">
                                ⭐ Personalizada
                              </span>
                            ) : (
                              <span className="text-[9px] text-slate-500 bg-slate-100 border border-slate-200 px-1.5 py-0.2 rounded">
                                Estándar
                              </span>
                            )}
                            <span className="text-[9px] text-slate-400 font-mono">
                              Tipo: {p.type}
                            </span>
                          </div>

                          {p.description && (
                            <p className="text-[11px] text-slate-500 mt-0.5 truncate">{p.description}</p>
                          )}

                          {hasOpts && (
                            <div className="mt-1 flex items-center gap-1 flex-wrap text-[10px] text-slate-500">
                              <span className="font-semibold text-indigo-900">
                                {p.options?.length} valores posibles:
                              </span>
                              <span className="text-slate-600 truncate max-w-md">
                                {(p.options || []).slice(0, 5).map((o) => o.label).join(', ')}
                                {(p.options?.length || 0) > 5 ? ` +${(p.options?.length || 0) - 5} más` : ''}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="shrink-0 ml-3 pt-0.5">
                        {isChecked ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded-full">
                            <Check className="w-3 h-3 text-indigo-600" />
                            Visible
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-400 hover:text-indigo-600 font-medium">
                            + Agregar
                          </span>
                        )}
                      </div>
                    </label>
                  );
                })}
            </div>

            {/* Modal Footer */}
            <div className="pt-4 flex items-center justify-between border-t border-slate-100">
              <span className="text-xs text-slate-500">
                <strong className="text-indigo-700 font-bold">{visibleCustomColumnNames.length}</strong> columnas adicionales activadas en la tabla
              </span>

              <button
                type="button"
                onClick={() => setIsColumnPickerOpen(false)}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors cursor-pointer"
              >
                Aplicar y Ver en Tabla
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Safety Modal with ACTUALIZAR guard */}
      {isConfirmModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center gap-3 text-amber-600 mb-3">
              <div className="p-2.5 rounded-full bg-amber-100">
                <AlertTriangle className="w-6 h-6 text-amber-600" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Confirmación de Modificación Masiva
                </h3>
                <p className="text-xs text-slate-500">
                  Verifica el detalle de los cambios antes de propagarlos a HubSpot CRM
                </p>
              </div>
            </div>

            {/* Explicit warning when updating by search criteria without visible filter results */}
            {isUpdatingByFilterCriteriaDirectly && (
              <div className="mb-4 p-3.5 bg-amber-50 rounded-xl border-2 border-amber-400 text-xs text-amber-950 space-y-2 shadow-xs">
                <div className="flex items-center gap-2 font-bold text-amber-950 text-xs sm:text-sm">
                  <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
                  <span>ADVERTENCIA: Actualización sin ver el resultado de filtros</span>
                </div>
                <p className="text-amber-900 leading-relaxed font-semibold">
                  Se actualizarán los leads con los criterios de la búsqueda, a pesar de que no se vea el resultado de ese filtro en la tabla.
                </p>
                <div className="bg-white/95 rounded-lg p-2.5 border border-amber-300 space-y-1.5">
                  <span className="font-bold text-[10px] text-amber-950 uppercase tracking-wide block">
                    Criterios de búsqueda que se aplicarán a los leads de HubSpot:
                  </span>
                  {activeFilterDescriptions.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5 text-[11px]">
                      {activeFilterDescriptions.map((crit, i) => (
                        <span key={i} className="inline-flex items-center gap-1 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 text-amber-950">
                          <span className="text-amber-700 font-medium">{crit.label}:</span>
                          <strong className="font-bold">{crit.value}</strong>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-amber-800 italic">
                      (No hay filtros restrictivos: la búsqueda abarcará los contactos correspondientes en el portal de HubSpot)
                    </p>
                  )}
                </div>
                <p className="text-[11px] text-amber-800 leading-tight">
                  Al confirmar, el sistema buscará en vivo en HubSpot todos los contactos que coincidan y aplicará de inmediato las modificaciones configuradas.
                </p>
              </div>
            )}

            <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 text-xs space-y-2.5 my-4 max-h-60 overflow-y-auto">
              <div className="flex justify-between pb-2 border-b border-slate-200 font-medium">
                <span className="text-slate-500">Total Leads a Modificar:</span>
                {isUpdatingByFilterCriteriaDirectly ? (
                  <span className="font-bold text-amber-900 text-xs bg-amber-100 px-2 py-0.5 rounded border border-amber-300">
                    Todos los que coincidan con la búsqueda (en vivo)
                  </span>
                ) : (
                  <span className="font-bold text-indigo-700 text-sm">{selectedContactIds.size} contactos (100% de los seleccionados)</span>
                )}
              </div>
              <div className="flex justify-between pb-2 border-b border-slate-200 font-medium text-[11px]">
                <span className="text-slate-500">Mecanismo de Ejecución:</span>
                <span className="font-semibold text-indigo-700">
                  {executionStrategy === 'batch_chunks'
                    ? 'Lotes Automáticos de CRM (hasta 100 por lote)'
                    : 'Actualización Individual Directa (1 a 1)'}
                </span>
              </div>
              {!isUpdatingByFilterCriteriaDirectly && (
                <div className="flex justify-between pb-2 border-b border-slate-200 font-medium text-[11px]">
                  <span className="text-slate-500">
                    {executionStrategy === 'batch_chunks' ? 'Partición en Lotes:' : 'Cola Asíncrona:'}
                  </span>
                  <span className="font-semibold text-slate-800">
                    {executionStrategy === 'batch_chunks'
                      ? `${Math.ceil(selectedContactIds.size / 100)} lote(s) ${
                          selectedContactIds.size > 100
                            ? `(Lote 1: 100 leads, Lote 2: ${selectedContactIds.size - 100} leads)`
                            : `(${selectedContactIds.size} leads)`
                        }`
                      : `${selectedContactIds.size} llamadas unitarias (2 workers concurrentes)`}
                  </span>
                </div>
              )}
              <div className="flex justify-between pb-2 border-b border-slate-200 font-medium text-[11px] text-emerald-800 bg-emerald-50/70 px-2 py-1 rounded">
                <span className="flex items-center gap-1 font-bold">
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                  Garantía de Cobertura:
                </span>
                <span className="font-bold">
                  {isUpdatingByFilterCriteriaDirectly
                    ? 'Se actualizará el 100% de los leads que cumplan los criterios'
                    : `Se actualizarán todos los ${selectedContactIds.size} leads (ninguno omitido)`}
                </span>
              </div>

              {configuredChangesList.map((chg, idx) => (
                <div key={idx} className="flex justify-between items-center py-1.5 border-b border-slate-100 last:border-0">
                  <span className="text-slate-500 text-xs">{chg.label}:</span>
                  <span className={`font-semibold text-xs ${chg.isClear ? 'text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded' : 'text-slate-900'}`}>
                    {chg.value}
                  </span>
                </div>
              ))}
            </div>

            <div className="p-3 bg-indigo-50 rounded-lg border border-indigo-200 text-[11px] text-indigo-900 flex items-start gap-2 mb-4">
              <ShieldAlert className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
              <span>
                {isUpdatingByFilterCriteriaDirectly ? (
                  <>
                    Los contactos se recuperarán según los <strong>criterios de búsqueda activos</strong> y se actualizarán automáticamente{' '}
                    {executionStrategy === 'batch_chunks'
                      ? 'en lotes de hasta 100 por petición HTTP a la API de HubSpot'
                      : 'mediante actualización individual con aislamiento de fallos'}
                    . <strong>La totalidad de los leads encontrados quedará actualizada.</strong>
                  </>
                ) : executionStrategy === 'batch_chunks' ? (
                  <>
                    La API de HubSpot limita cada solicitud a <strong>máximo 100 objetos</strong>. El sistema procesará tus <strong>{selectedContactIds.size} contactos</strong> dividiéndolos de forma automática en <strong>{Math.ceil(selectedContactIds.size / 100)} lote(s)</strong> consecutivos de hasta 100 c/u con pausa de 100ms. <strong>Todos los {selectedContactIds.size} contactos serán actualizados.</strong>
                  </>
                ) : (
                  <>
                    Se llamará la herramienta individual <strong>hubspot_update_contact</strong> para cada uno de los <strong>{selectedContactIds.size} contactos</strong> mediante un <strong>pool de workers</strong> con rate limiting. Todos los contactos serán procesados con aislamiento de errores.
                  </>
                )}
              </span>
            </div>

            {/* Classic Safety Reconfirmation Box */}
            <div className="mb-5 p-4 rounded-xl bg-amber-50/90 border border-amber-200">
              <label className="block text-xs font-semibold text-slate-800 mb-1.5 flex items-center justify-between">
                <span>
                  Escribe <strong className="font-mono bg-amber-200 text-amber-950 px-2 py-0.5 rounded tracking-wider border border-amber-300">ACTUALIZAR</strong> para confirmar:
                </span>
                {confirmKeyword.trim().toUpperCase() === 'ACTUALIZAR' && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-100/80 px-2 py-0.5 rounded-full border border-emerald-300 animate-in fade-in duration-100">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    Correcto
                  </span>
                )}
              </label>
              <input
                type="text"
                autoFocus
                value={confirmKeyword}
                onChange={(e) => setConfirmKeyword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && confirmKeyword.trim().toUpperCase() === 'ACTUALIZAR') {
                    handleExecuteBatch();
                  }
                }}
                placeholder="Escribe ACTUALIZAR"
                className={`w-full text-xs font-mono font-bold px-3 py-2.5 rounded-lg border transition-all uppercase tracking-wider ${
                  confirmKeyword.trim().toUpperCase() === 'ACTUALIZAR'
                    ? 'bg-emerald-50 border-emerald-500 text-emerald-900 ring-2 ring-emerald-400/30'
                    : 'bg-white border-amber-300 text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200'
                }`}
              />
              <p className="text-[11px] text-slate-500 mt-1.5">
                Debes escribir la palabra exacta para desbloquear el botón de confirmación.
              </p>
            </div>

            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => {
                  setIsConfirmModalOpen(false);
                  setConfirmKeyword('');
                }}
                className="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={handleExecuteBatch}
                disabled={confirmKeyword.trim().toUpperCase() !== 'ACTUALIZAR' || isExecuting}
                className={`px-5 py-2.5 text-xs font-semibold rounded-lg shadow-sm transition-all flex items-center gap-2 ${
                  confirmKeyword.trim().toUpperCase() === 'ACTUALIZAR'
                    ? 'bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white cursor-pointer shadow-indigo-200'
                    : 'bg-slate-200 text-slate-400 cursor-not-allowed border border-slate-300/50'
                }`}
              >
                <CheckCircle2 className="w-4 h-4" />
                {isUpdatingByFilterCriteriaDirectly ? (
                  <>Confirmar y Actualizar por Criterios</>
                ) : (
                  <>Confirmar y Sincronizar ({selectedContactIds.size})</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Execution Progress & Resilient Batch Monitor with Integrated History */}
      {(isExecuting || executionComplete || resultsActiveTab === 'history') && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs animate-in slide-in-from-bottom-2 duration-200 mt-6 scroll-mt-24" id="execution-monitor-card">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 mb-4 border-b border-slate-100 gap-3">
            <div className="flex items-center gap-2">
              <div className={`p-1.5 rounded-md ${executionComplete ? 'bg-emerald-100 text-emerald-700' : isExecuting ? 'bg-indigo-100 text-indigo-700 animate-spin' : 'bg-slate-100 text-slate-700'}`}>
                {executionComplete ? (
                  <CheckCircle2 className="w-4 h-4" />
                ) : isExecuting ? (
                  <RefreshCw className="w-4 h-4" />
                ) : (
                  <Activity className="w-4 h-4" />
                )}
              </div>
              <div>
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wide">
                  {executionComplete
                    ? 'Sincronización Masiva Completada'
                    : isExecuting
                    ? executionStrategy === 'batch_chunks'
                      ? 'Ejecutando Sincronización por Lotes en HubSpot CRM'
                      : 'Ejecutando Sincronización Individual en HubSpot CRM'
                    : 'Panel de Resultados y Auditoría'}
                </h4>
                <p className="text-[11px] text-slate-500">
                  {isExecuting
                    ? `${executionProgress.current} de ${executionProgress.total} contactos procesados (${executionProgress.pct}%)`
                    : executionComplete
                    ? `${executionProgress.total} contactos sincronizados exitosamente`
                    : 'Supervisión en tiempo real y registro histórico de actualizaciones masivas'}
                </p>
              </div>
            </div>

            {/* In-Card Tab Navigation */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-medium">
                <button
                  type="button"
                  onClick={() => setResultsActiveTab('current')}
                  className={`px-3 py-1.5 rounded-md transition-colors cursor-pointer flex items-center gap-1.5 ${
                    resultsActiveTab === 'current'
                      ? 'bg-white text-indigo-700 font-semibold shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Activity className="w-3.5 h-3.5 text-indigo-600" />
                  <span>Resultado Actual</span>
                </button>

                <button
                  type="button"
                  onClick={() => setResultsActiveTab('history')}
                  className={`px-3 py-1.5 rounded-md transition-colors cursor-pointer flex items-center gap-1.5 ${
                    resultsActiveTab === 'history'
                      ? 'bg-white text-indigo-700 font-semibold shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <History className="w-3.5 h-3.5 text-indigo-600" />
                  <span>Historial de Actualizaciones</span>
                </button>
              </div>

              {executionComplete && (
                <button
                  onClick={() => {
                    setExecutionComplete(false);
                    setResultsActiveTab('current');
                  }}
                  className="p-1 hover:bg-slate-100 text-slate-400 hover:text-slate-600 rounded transition-colors cursor-pointer"
                  title="Cerrar resultados"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {/* Tab 1: Current Results View */}
          {resultsActiveTab === 'current' && (
            <div className="space-y-3">
              {/* Summary Stats Strip */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5 text-xs bg-slate-50 p-3 rounded-lg border border-slate-200">
                <div>
                  <span className="text-slate-500 block text-[10px] uppercase font-bold">Mecanismo:</span>
                  <span className="font-semibold text-slate-800">
                    {executionStrategy === 'batch_chunks' ? 'Lotes Automáticos' : 'Individual 1 a 1'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px] uppercase font-bold">Usuario de Sesión:</span>
                  <span className="font-semibold text-slate-800">
                    {userName || user?.email || 'Usuario Actual'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px] uppercase font-bold">Progreso:</span>
                  <span className="font-semibold text-slate-800">
                    {executionProgress.current} de {executionProgress.total} ({executionProgress.pct}%)
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px] uppercase font-bold">Estado:</span>
                  <span className={`font-semibold ${executionComplete ? 'text-emerald-700' : 'text-indigo-700'}`}>
                    {executionComplete ? '✓ Completado' : 'En Ejecución...'}
                  </span>
                </div>
              </div>

              {/* Progress Bar */}
              <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden border border-slate-200">
                <div
                  className={`h-2.5 rounded-full transition-all duration-150 ${
                    executionComplete ? 'bg-emerald-500' : 'bg-indigo-600'
                  }`}
                  style={{ width: `${executionProgress.pct}%` }}
                />
              </div>

              {/* Live Activity Feed */}
              <div className="bg-slate-900 rounded-lg p-3 max-h-40 overflow-y-auto font-mono text-[11px] text-slate-300 space-y-1">
                <div className="text-slate-400 border-b border-slate-800 pb-1 flex justify-between">
                  <span>[HubSpot CRM] Registro en Tiempo Real</span>
                  <span className="text-emerald-400 font-bold">EN LÍNEA</span>
                </div>
                {executionProgress.log.length === 0 ? (
                  <div className="text-slate-500 italic py-2">
                    Iniciando proceso de actualización en el servidor...
                  </div>
                ) : (
                  executionProgress.log.slice(-8).map((item) => (
                    <div key={item.id} className="flex items-center justify-between text-slate-300">
                      <span>
                        &gt; {item.status || `Contacto ID ${item.contactId}: Actualizado exitosamente en CRM`}
                      </span>
                      <span className="text-emerald-400 font-bold">{item.time}</span>
                    </div>
                  ))
                )}
                {executionComplete && (
                  <div className="text-emerald-300 font-bold pt-1 border-t border-slate-800 flex items-center justify-between flex-wrap gap-2">
                    <span>✓ Sincronización finalizada exitosamente para {executionProgress.total} contactos en HubSpot CRM.</span>
                    <button
                      type="button"
                      onClick={() => setResultsActiveTab('history')}
                      className="text-xs text-indigo-300 hover:text-indigo-100 underline cursor-pointer font-sans font-medium"
                    >
                      Ver en Historial de Auditoría &rarr;
                    </button>
                  </div>
                )}
              </div>

              {executionComplete && (
                <div className="flex items-center justify-between pt-2 flex-wrap gap-2">
                  <span className="text-xs text-slate-500">
                    Operación registrada en el log de auditoría con identificador de trabajo #{lastJobId || 'JOB-001'}.
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setResultsActiveTab('history')}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-semibold rounded-lg border border-indigo-200 transition-colors cursor-pointer"
                    >
                      <History className="w-3.5 h-3.5" />
                      <span>Ver y Filtrar Historial Anterior</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Tab 2: History Embedded Directly in Results Card */}
          {resultsActiveTab === 'history' && (
            <BulkOperationsHistoryCard
              currentJobId={lastJobId}
              isEmbeddedInResults={true}
            />
          )}
        </div>
      )}

      {/* Standalone History Modal */}
      {isHistoryModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-5xl w-full max-h-[90vh] shadow-2xl border border-slate-200 flex flex-col overflow-hidden">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <History className="w-5 h-5 text-indigo-600" />
                <h3 className="text-sm font-bold text-slate-900">
                  Historial de Actualizaciones Masivas Anteriores
                </h3>
              </div>
              <button
                onClick={() => setIsHistoryModalOpen(false)}
                className="p-1.5 hover:bg-slate-200 text-slate-500 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-1">
              <BulkOperationsHistoryCard
                currentJobId={lastJobId}
                onClose={() => setIsHistoryModalOpen(false)}
              />
            </div>
          </div>
        </div>
      )}

      {/* Action Panel Popup Modal */}
      {isActionPanelPopupOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-4xl w-full max-h-[92vh] shadow-2xl border border-slate-200 flex flex-col overflow-hidden">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <ArrowRightLeft className="w-5 h-5 text-indigo-600" />
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Ventana Emergente: Modificaciones Masivas (Destino)
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Configura y confirma los cambios masivos a sincronizar en HubSpot CRM.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsActionPanelPopupOpen(false)}
                className="p-1.5 hover:bg-slate-200 text-slate-500 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto flex-1 space-y-4">
              <div className="p-3 bg-indigo-50/70 border border-indigo-200 rounded-lg text-xs text-indigo-900 flex items-center justify-between">
                <div>
                  {isUpdatingByFilterCriteriaDirectly ? (
                    <span>⚡ Se actualizarán los leads que cumplan los <strong>criterios del filtro</strong>.</span>
                  ) : (
                    <span>Total a modificar: <strong>{selectedContactIds.size} leads seleccionados</strong> en la lista.</span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setIsActionPanelPopupOpen(false);
                    const el = document.getElementById('bulk-action-panel');
                    el?.scrollIntoView({ behavior: 'smooth' });
                  }}
                  className="text-[11px] font-semibold text-indigo-700 hover:text-indigo-900 underline cursor-pointer"
                >
                  Ver en formulario inferior &darr;
                </button>
              </div>

              <p className="text-xs text-slate-600">
                Los cambios configurados en el formulario principal se aplican de forma inmediata. Haz clic abajo para confirmar la ejecución.
              </p>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsActionPanelPopupOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                >
                  Cerrar Ventana Emergente
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsActionPanelPopupOpen(false);
                    setConfirmKeyword('');
                    setIsConfirmModalOpen(true);
                  }}
                  disabled={!hasChangesConfigured || isExecuting}
                  className="px-5 py-2 text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Proceder a Confirmar ({selectedContactIds.size})</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
