import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  FileSpreadsheet,
  Download,
  Mail,
  Users,
  CheckCircle2,
  AlertCircle,
  Filter,
  Calendar,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Code2,
  Table,
  Check,
  Copy,
  ShieldCheck,
  Sliders,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Save,
  Database,
  Search,
  RotateCcw,
  Pencil,
  UserCheck,
  SlidersHorizontal,
  Layers,
  Eye,
  Play,
  Clock,
  Flame,
  Building2,
  Globe,
} from 'lucide-react';
import {
  HubSpotOwner,
  HubSpotReportConfig,
  HubSpotPropertyConfig,
  CustomPropertyFilter,
  DEFAULT_HUBSPOT_REPORT_CONFIG,
  DEFAULT_HUBSPOT_REPORT_PROPERTIES,
  DEFAULT_PIVOT_CONFIG,
  PivotAggregator,
  sanitizeReportConfig,
} from '../types';
import { useAuth } from '../context/AuthContext';
import { mcpHubspot } from '../services/mcpHubspot';
import { extractFieldValue } from '../utils/hubspotFieldExtractor';

interface HubSpotExcelReportPanelProps {
  owners: HubSpotOwner[];
}

interface GeneratedReportItem {
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
  downloadUrl: string;
  excelBase64?: string;
  contacts?: any[];
  matrixSummary?: {
    columnHeaders: string[];
    rowHeaders: string[];
    grid: Record<string, Record<string, number>>;
    columnTotals: Record<string, number>;
    rowTotals: Record<string, number>;
    grandTotal: number;
    pivotConfig?: {
      rowField: string;
      rowFieldLabel?: string;
      columnField: string;
      columnFieldLabel?: string;
      metricField?: string;
      metricLabel: string;
      aggregator?: PivotAggregator;
    };
  };
}

// Helper para comparar si dos configuraciones son estructuralmente idénticas
const areConfigsEqual = (a?: HubSpotReportConfig | null, b?: HubSpotReportConfig | null): boolean => {
  if (!a && !b) return true;
  if (!a || !b) return false;

  const aProps = (a.selectedProperties || []).map((p) => `${p.name}:${p.label}:${p.enabled}`).join('|');
  const bProps = (b.selectedProperties || []).map((p) => `${p.name}:${p.label}:${p.enabled}`).join('|');
  if (aProps !== bProps) return false;

  const aCustomFilters = (a.filters?.customFilters || [])
    .map((f) => `${f.propertyName}:${f.operator}:${f.value || ''}`)
    .join('|');
  const bCustomFilters = (b.filters?.customFilters || [])
    .map((f) => `${f.propertyName}:${f.operator}:${f.value || ''}`)
    .join('|');
  const aFilters = `${a.filters?.campaign || ''}_${a.filters?.filterValue || ''}_${a.filters?.dateRange || ''}_${a.filters?.startDate || ''}_${a.filters?.endDate || ''}_${aCustomFilters}`;
  const bFilters = `${b.filters?.campaign || ''}_${b.filters?.filterValue || ''}_${b.filters?.dateRange || ''}_${b.filters?.startDate || ''}_${b.filters?.endDate || ''}_${bCustomFilters}`;
  if (aFilters !== bFilters) return false;

  const aPivot = `${a.pivotConfig?.rowField || ''}_${a.pivotConfig?.columnField || ''}_${a.pivotConfig?.metricLabel || ''}_${a.pivotConfig?.aggregator || ''}_${a.pivotConfig?.metricField || ''}_${a.pivotConfig?.filterField || ''}_${a.pivotConfig?.filterFieldLabel || ''}`;
  const bPivot = `${b.pivotConfig?.rowField || ''}_${b.pivotConfig?.columnField || ''}_${b.pivotConfig?.metricLabel || ''}_${b.pivotConfig?.aggregator || ''}_${b.pivotConfig?.metricField || ''}_${b.pivotConfig?.filterField || ''}_${b.pivotConfig?.filterFieldLabel || ''}`;
  if (aPivot !== bPivot) return false;

  if (Boolean(a.sendEmailDefault) !== Boolean(b.sendEmailDefault)) return false;
  if ((a.sheet1NameFormat || '') !== (b.sheet1NameFormat || '')) return false;

  return true;
};

const LEAD_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'NEW', label: 'Nuevo' },
  { value: 'OPEN', label: 'Abierto' },
  { value: 'IN_PROGRESS', label: 'En Progreso' },
  { value: 'OPEN_DEAL', label: 'Negocio Abierto' },
  { value: 'UNQUALIFIED', label: 'Descalificado' },
  { value: 'ATTEMPTED_TO_CONTACT', label: 'Intento de Contacto' },
  { value: 'CONNECTED', label: 'Conectado' },
  { value: 'BAD_TIMING', label: 'Momento Inoportuno' },
];

const LIFECYCLE_OPTIONS: { value: string; label: string }[] = [
  { value: 'subscriber', label: 'Suscriptor' },
  { value: 'lead', label: 'Lead General' },
  { value: 'marketingqualifiedlead', label: 'MQL (Marketing Qualified Lead)' },
  { value: 'salesqualifiedlead', label: 'SQL (Sales Qualified Lead)' },
  { value: 'opportunity', label: 'Oportunidad Comercial' },
  { value: 'customer', label: 'Cliente Ganado' },
  { value: 'evangelist', label: 'Evangelista' },
  { value: 'other', label: 'Otro / Inactivo' },
];

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

export const HubSpotExcelReportPanel: React.FC<HubSpotExcelReportPanelProps> = ({ owners }) => {
  const { company, updateCompanyReportConfig } = useAuth();

  // Flag de cambios pendientes realizados por el usuario para evitar bucles de sincronización
  const hasPendingChangesRef = useRef<boolean>(false);

  // Active top tab
  const [activeTab, setActiveTab] = useState<'config' | 'generator'>('config');

  // Load initial config from company.hubspot_report_config or localStorage fallback or default
  const getInitialConfig = (): HubSpotReportConfig => {
    let raw: any = company?.hubspot_report_config;
    if (!raw && typeof window !== 'undefined') {
      try {
        const key = company?.client_id
          ? `hubspot_report_config_${company.client_id}`
          : 'hubspot_report_config_fallback';
        const stored = localStorage.getItem(key);
        if (stored) raw = JSON.parse(stored);
      } catch (_) {}
    }
    return sanitizeReportConfig(raw);
  };

  const [reportConfig, setReportConfig] = useState<HubSpotReportConfig>(getInitialConfig);

  // Form parameters
  const [selectedOwnerId, setSelectedOwnerId] = useState<string>('ALL');
  const [filterValue, setFilterValue] = useState<string>(
    reportConfig.filters?.filterValue || reportConfig.filters?.campaign || '(Varios elementos)',
  );
  const [campaign, setCampaign] = useState<string>(
    reportConfig.filters?.filterValue || reportConfig.filters?.campaign || '(Varios elementos)',
  );
  const [dateRange, setDateRange] = useState<string>(
    reportConfig.filters?.dateRange || 'last_365d',
  );
  const [startDate, setStartDate] = useState<string>(
    reportConfig.filters?.startDate || '',
  );
  const [endDate, setEndDate] = useState<string>(
    reportConfig.filters?.endDate || '',
  );
  const [showCustomFiltersSection, setShowCustomFiltersSection] = useState<boolean>(
    Boolean(reportConfig.filters?.customFilters && reportConfig.filters.customFilters.length > 0),
  );
  const [showAdvancedFilters, setShowAdvancedFilters] = useState<boolean>(true);
  const [sendEmail, setSendEmail] = useState<boolean>(
    reportConfig.sendEmailDefault !== undefined ? reportConfig.sendEmailDefault : true,
  );
  const [showSmtpConfig, setShowSmtpConfig] = useState<boolean>(false);
  const [showCodeExample, setShowCodeExample] = useState<boolean>(false);
  const [expandedMatrixReportId, setExpandedMatrixReportId] = useState<string | null>(null);

  // Custom SMTP configuration
  const [smtpHost, setSmtpHost] = useState<string>('');
  const [smtpPort, setSmtpPort] = useState<number>(587);
  const [smtpUser, setSmtpUser] = useState<string>('');
  const [smtpPass, setSmtpPass] = useState<string>('');
  const [emailFrom, setEmailFrom] = useState<string>('reportes-crm@hubops.com');

  // Generation status
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [currentStep, setCurrentStep] = useState<string>('');
  const [generatedReports, setGeneratedReports] = useState<GeneratedReportItem[]>([]);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);
  const [copiedSnippet, setCopiedSnippet] = useState<boolean>(false);

  // Config tab state
  const [propertyFilterKeyword, setPropertyFilterKeyword] = useState<string>('');
  const [propertyFilterCategory, setPropertyFilterCategory] = useState<'all' | 'selected' | 'standard' | 'custom'>('all');
  const [isSavingConfig, setIsSavingConfig] = useState<boolean>(false);
  const [saveSuccessMessage, setSaveSuccessMessage] = useState<string | null>(null);
  const [showAddCustomModal, setShowAddCustomModal] = useState<boolean>(false);
  const [newCustomPropName, setNewCustomPropName] = useState<string>('');
  const [newCustomPropLabel, setNewCustomPropLabel] = useState<string>('');
  const [newCustomPropType, setNewCustomPropType] = useState<string>('string');

  // Keep track of external available properties from HubSpot CRM API
  const [availableHubSpotProps, setAvailableHubSpotProps] = useState<Array<{ name: string; label: string; isCustom: boolean; type?: string }>>([]);

  // Filter options per property (campaigns list, careers, sources, lifecycle stages, etc.)
  const [isManualFilterInput, setIsManualFilterInput] = useState<boolean>(false);
  const [freeTextFilterRuleIds, setFreeTextFilterRuleIds] = useState<Set<string>>(new Set());
  const [filterOptionsMap, setFilterOptionsMap] = useState<Record<string, string[]>>({
    campana: [
      '(Varios elementos)',
      'Campaña Ejecutiva Q3',
      'meta_q3_retargeting',
      'google_search_b2b',
      'direct_outreach',
      'Campaña General 2026',
      'Campaña Verano 2026',
      'Pauta Digital Facebook/Instagram',
    ],
    carrera_de_interes: [
      '(Varios elementos)',
      'MBA Internacional y Dirección Estratégica',
      'Diplomado en Marketing Digital & Growth',
      'Maestría en Data Analytics & Business Intelligence',
      'Administración y Finanzas',
      'Medicina Humana',
      'Derecho Corporativo',
      'Ingeniería de Sistemas',
    ],
    fuente: [
      '(Varios elementos)',
      'Formulario web',
      'Whatsapp',
      'Referido',
      'Pauta Digital / Redes',
      'Orgánico / Buscador',
      'Acceso Directo',
    ],
    lifecyclestage: [
      '(Varios elementos)',
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
    ],
    hs_lead_status: [
      '(Varios elementos)',
      'Nuevo (NEW)',
      'Abierto (OPEN)',
      'En Progreso (IN_PROGRESS)',
      'Negocio Abierto (OPEN_DEAL)',
      'No Calificado (UNQUALIFIED)',
      'Intento de Contacto (ATTEMPTED_TO_CONTACT)',
      'Conectado (CONNECTED)',
      'Mal Momento (BAD_TIMING)',
    ],
    city: [
      '(Varios elementos)',
      'Lima',
      'Santiago',
      'Medellín',
      'La Paz',
      'Concepción',
      'Bogotá',
      'CDMX',
    ],
  });

  // Keep track of latest reportConfig in a ref for equality checks
  const reportConfigRef = useRef<HubSpotReportConfig>(reportConfig);
  useEffect(() => {
    reportConfigRef.current = reportConfig;
  }, [reportConfig]);

  // Auto-sync when company data finishes loading or changes in AuthContext
  useEffect(() => {
    if (company?.hubspot_report_config) {
      const sanitized = sanitizeReportConfig(company.hubspot_report_config);
      // Evitar re-sincronizaciones cíclicas si los datos son equivalentes
      if (!areConfigsEqual(sanitized, reportConfigRef.current)) {
        setReportConfig(sanitized);
        if (sanitized.filters?.filterValue || sanitized.filters?.campaign) {
          const val = sanitized.filters.filterValue || sanitized.filters.campaign || '(Varios elementos)';
          setFilterValue(val);
          setCampaign(val);
        }
        if (sanitized.filters?.dateRange) {
          setDateRange(sanitized.filters.dateRange);
        }
        if (sanitized.filters?.startDate !== undefined) {
          setStartDate(sanitized.filters.startDate);
        }
        if (sanitized.filters?.endDate !== undefined) {
          setEndDate(sanitized.filters.endDate);
        }
        if (sanitized.sendEmailDefault !== undefined) {
          setSendEmail(sanitized.sendEmailDefault);
        }
      }
      // Al venir de la BD, NO hay cambios pendientes del usuario
      hasPendingChangesRef.current = false;
    }
  }, [company?.hubspot_report_config]);

  // Load properties from HubSpot CRM
  useEffect(() => {
    const loadHubSpotProps = async () => {
      try {
        const props = await mcpHubspot.hubspot_get_contact_properties();
        if (Array.isArray(props) && props.length > 0) {
          setAvailableHubSpotProps(
            props.map((p) => ({
              name: p.name,
              label: p.label || p.name,
              isCustom: Boolean(p.isCustom),
              type: p.type || 'string',
            })),
          );
        }
      } catch (_) {}
    };
    loadHubSpotProps();
  }, []);

  // Load existing reports logs
  const loadExistingLogs = async () => {
    try {
      const res = await fetch('/api/reports/logs');
      if (res.ok) {
        const data = await res.json();
        if (data.logs && data.logs.length > 0) {
          setGeneratedReports(data.logs);
        }
      }
    } catch (_) {}
  };

  // Load distinct filter options per property (campaigns, careers, sources, stages, statuses, etc.)
  useEffect(() => {
    const loadFilterOptions = async () => {
      try {
        const token = typeof window !== 'undefined' ? localStorage.getItem('hubspot_token') || '' : '';
        const res = await fetch('/api/reports/filter-options', {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.ok) {
          const data = await res.json();
          if (data.options) {
            setFilterOptionsMap((prev) => ({
              ...prev,
              ...data.options,
            }));
          }
        }
      } catch (_) {}
    };
    loadFilterOptions();
  }, []);

  useEffect(() => {
    loadExistingLogs();
  }, []);

  // Debounced auto-save
  // SOLO se dispara si el usuario realizó un cambio explícito en la interfaz
  const isInitialMount = useRef(true);
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    // Si no hay cambios explícitos del usuario, NO auto-guardar
    if (!hasPendingChangesRef.current) {
      return;
    }

    const timer = setTimeout(async () => {
      if (!hasPendingChangesRef.current) return;
      hasPendingChangesRef.current = false;

      setIsSavingConfig(true);
      const res = await updateCompanyReportConfig(reportConfig);
      setIsSavingConfig(false);
      if (res.success) {
        setSaveSuccessMessage('Configuración guardada');
        setTimeout(() => setSaveSuccessMessage(null), 3000);
      }
    }, 1200);

    return () => clearTimeout(timer);
  }, [reportConfig, updateCompanyReportConfig]);

  // Manual save trigger
  const handleManualSaveConfig = async () => {
    hasPendingChangesRef.current = false;
    setIsSavingConfig(true);
    const updated: HubSpotReportConfig = {
      ...reportConfig,
      filters: {
        ...reportConfig.filters,
        campaign: filterValue || campaign,
        filterValue: filterValue || campaign,
        dateRange,
        startDate: dateRange === 'custom' ? startDate : '',
        endDate: dateRange === 'custom' ? endDate : '',
      },
      sendEmailDefault: sendEmail,
      updatedAt: new Date().toISOString(),
    };
    setReportConfig(updated);
    const res = await updateCompanyReportConfig(updated);
    setIsSavingConfig(false);
    if (res.success) {
      setSaveSuccessMessage('¡Configuración guardada exitosamente!');
      setTimeout(() => setSaveSuccessMessage(null), 3500);
    } else {
      setErrorNotice(res.error || 'Error al persistir configuración');
    }
  };

  // Reset to default 21 properties
  const handleResetToDefault = async () => {
    hasPendingChangesRef.current = false;
    const freshDefault: HubSpotReportConfig = {
      ...DEFAULT_HUBSPOT_REPORT_CONFIG,
      updatedAt: new Date().toISOString(),
    };
    setReportConfig(freshDefault);
    setCampaign(freshDefault.filters.campaign || '(Varios elementos)');
    setDateRange(freshDefault.filters.dateRange || 'last_365d');
    setSendEmail(true);
    setIsSavingConfig(true);
    await updateCompanyReportConfig(freshDefault);
    setIsSavingConfig(false);
    setSaveSuccessMessage('Restablecida la estructura original estándar de 21 campos.');
    setTimeout(() => setSaveSuccessMessage(null), 3000);
  };

  // Toggle property enabled status
  const handleToggleProperty = (propName: string) => {
    hasPendingChangesRef.current = true;
    setReportConfig((prevRaw) => {
      const prev = sanitizeReportConfig(prevRaw);
      const exists = prev.selectedProperties.some((p) => p.name === propName);
      let updatedProps: HubSpotPropertyConfig[];

      if (exists) {
        updatedProps = prev.selectedProperties.map((p) =>
          p.name === propName ? { ...p, enabled: !p.enabled } : p,
        );
      } else {
        const meta = (availableHubSpotProps || []).find((p) => p.name === propName);
        updatedProps = [
          ...prev.selectedProperties,
          {
            name: propName,
            label: meta?.label || propName,
            type: meta?.type || 'string',
            isCustom: meta?.isCustom ?? true,
            enabled: true,
          },
        ];
      }

      return {
        ...prev,
        selectedProperties: updatedProps,
        updatedAt: new Date().toISOString(),
      };
    });
  };

  // Edit property label
  const handleEditPropertyLabel = (propName: string, newLabel: string) => {
    hasPendingChangesRef.current = true;
    setReportConfig((prevRaw) => {
      const prev = sanitizeReportConfig(prevRaw);
      return {
        ...prev,
        selectedProperties: prev.selectedProperties.map((p) =>
          p.name === propName ? { ...p, label: newLabel } : p,
        ),
        updatedAt: new Date().toISOString(),
      };
    });
  };

  // Move property position up/down
  const handleMoveProperty = (index: number, direction: 'up' | 'down') => {
    hasPendingChangesRef.current = true;
    setReportConfig((prevRaw) => {
      const prev = sanitizeReportConfig(prevRaw);
      const items = [...prev.selectedProperties];
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= items.length) return prev;
      const [moved] = items.splice(index, 1);
      items.splice(targetIndex, 0, moved);
      return {
        ...prev,
        selectedProperties: items,
        updatedAt: new Date().toISOString(),
      };
    });
  };

  // Remove property from list
  const handleRemoveProperty = (propName: string) => {
    hasPendingChangesRef.current = true;
    setReportConfig((prevRaw) => {
      const prev = sanitizeReportConfig(prevRaw);
      return {
        ...prev,
        selectedProperties: prev.selectedProperties.filter((p) => p.name !== propName),
        updatedAt: new Date().toISOString(),
      };
    });
  };

  // Add custom property manually
  const handleAddCustomProperty = () => {
    if (!newCustomPropName.trim()) return;
    const cleanName = newCustomPropName.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const cleanLabel = newCustomPropLabel.trim() || cleanName;

    hasPendingChangesRef.current = true;
    setReportConfig((prevRaw) => {
      const prev = sanitizeReportConfig(prevRaw);
      const exists = prev.selectedProperties.some((p) => p.name === cleanName);
      if (exists) {
        return {
          ...prev,
          selectedProperties: prev.selectedProperties.map((p) =>
            p.name === cleanName ? { ...p, enabled: true, label: cleanLabel } : p,
          ),
        };
      }
      return {
        ...prev,
        selectedProperties: [
          ...prev.selectedProperties,
          {
            name: cleanName,
            label: cleanLabel,
            type: newCustomPropType,
            isCustom: true,
            enabled: true,
          },
        ],
        updatedAt: new Date().toISOString(),
      };
    });

    setNewCustomPropName('');
    setNewCustomPropLabel('');
    setShowAddCustomModal(false);
    setSaveSuccessMessage(`Campo personalizado "${cleanLabel}" añadido.`);
    setTimeout(() => setSaveSuccessMessage(null), 3000);
  };

  // Select all or deselect all
  const handleSelectAllProperties = (enabled: boolean) => {
    hasPendingChangesRef.current = true;
    setReportConfig((prevRaw) => {
      const prev = sanitizeReportConfig(prevRaw);
      return {
        ...prev,
        selectedProperties: prev.selectedProperties.map((p) => ({ ...p, enabled })),
        updatedAt: new Date().toISOString(),
      };
    });
  };

  // Update pivot config fields
  const handleUpdatePivotConfig = (field: keyof typeof reportConfig.pivotConfig, value: string) => {
    hasPendingChangesRef.current = true;
    setReportConfig((prevRaw) => {
      const prev = sanitizeReportConfig(prevRaw);
      const updatedPivot = {
        ...prev.pivotConfig,
        [field]: value,
      };

      if (field === 'rowField') {
        const found =
          prev.selectedProperties.find((p) => p.name === value) ||
          (availableHubSpotProps || []).find((p) => p.name === value);
        if (found) updatedPivot.rowFieldLabel = found.label;
      } else if (field === 'columnField') {
        const found =
          prev.selectedProperties.find((p) => p.name === value) ||
          (availableHubSpotProps || []).find((p) => p.name === value);
        if (found) updatedPivot.columnFieldLabel = found.label;
      } else if (field === 'aggregator' || field === 'metricField') {
        const currentAgg = (field === 'aggregator' ? value : updatedPivot.aggregator || 'COUNT') as PivotAggregator;
        const currentField = field === 'metricField' ? value : updatedPivot.metricField || 'hs_lead_status';
        const found =
          prev.selectedProperties.find((p) => p.name === currentField) ||
          (availableHubSpotProps || []).find((p) => p.name === currentField);
        const fLabel = found?.label || currentField;

        const aggNames: Record<PivotAggregator, string> = {
          COUNT: 'Cuenta de',
          SUM: 'Suma de',
          AVG: 'Promedio de',
          MAX: 'Máximo de',
          MIN: 'Mínimo de',
        };
        updatedPivot.metricLabel = `${aggNames[currentAgg] || 'Cuenta de'} ${fLabel}`;
      } else if (field === 'filterField') {
        const found =
          prev.selectedProperties.find((p) => p.name === value) ||
          (availableHubSpotProps || []).find((p) => p.name === value);
        const fLabel = found?.label || value;
        updatedPivot.filterFieldLabel = fLabel.toLowerCase().startsWith('seleccionar')
          ? fLabel
          : `Seleccionar ${fLabel}`;
      }

      return {
        ...prev,
        pivotConfig: updatedPivot,
        updatedAt: new Date().toISOString(),
      };
    });
  };

  const currentFilterField = reportConfig.pivotConfig.filterField || 'campana';

  // Available options for the active filter field
  const availableOptionsForCurrentField = useMemo(() => {
    let list = filterOptionsMap[currentFilterField];
    if (!list && (currentFilterField === 'campana' || currentFilterField === 'utm_campaign')) {
      list = filterOptionsMap.campana;
    }
    if (!list && (currentFilterField === 'fuente' || currentFilterField === 'FUENTE')) {
      list = filterOptionsMap.fuente;
    }
    if (!list && (currentFilterField === 'carrera_de_interes' || currentFilterField === 'carrera')) {
      list = filterOptionsMap.carrera_de_interes;
    }

    if (!list || list.length <= 1) {
      const propDef = (availableHubSpotProps || []).find((p) => p.name === currentFilterField);
      if (propDef && (propDef as any).options && Array.isArray((propDef as any).options)) {
        const optValues = (propDef as any).options.map((o: any) => o.label || o.value);
        list = ['(Todos)', ...optValues];
      }
    }

    if (!list || list.length === 0) {
      list = ['(Todos)'];
    }

    const seen = new Set<string>();
    const result: string[] = ['(Todos)'];
    seen.add('(todos)');
    seen.add('(varios elementos)');
    for (const item of list) {
      if (item && item !== '(Varios elementos)' && item !== '(Todas)' && item !== '(Todos)' && !seen.has(item.toLowerCase())) {
        seen.add(item.toLowerCase());
        result.push(item);
      }
    }
    return result;
  }, [filterOptionsMap, currentFilterField, availableHubSpotProps]);

  // Handle changing the filter property from dropdown
  const handleFilterPropertyChange = (newField: string) => {
    handleUpdatePivotConfig('filterField', newField);
    const defaultVal = '(Todos)';
    setFilterValue(defaultVal);
    setCampaign(defaultVal);
    setIsManualFilterInput(false);
    hasPendingChangesRef.current = true;
    setReportConfig((prev) => ({
      ...prev,
      filters: {
        ...prev.filters,
        campaign: defaultVal,
        filterValue: defaultVal,
      },
    }));
  };

  // Helper flexible para obtener valores reales de cualquier propiedad de contacto
  const getOptionsForProperty = (propName: string): string[] => {
    if (!propName) return [];
    let list = filterOptionsMap[propName];
    if (!list && (propName === 'campana' || propName === 'utm_campaign')) {
      list = filterOptionsMap.campana;
    }
    if (!list && (propName === 'fuente' || propName === 'utm_source' || propName === 'FUENTE')) {
      list = filterOptionsMap.fuente;
    }
    if (!list && (propName === 'carrera_de_interes' || propName === 'carrera')) {
      list = filterOptionsMap.carrera_de_interes;
    }
    if (!list && (propName === 'lifecyclestage' || propName === 'etapa')) {
      list = filterOptionsMap.lifecyclestage;
    }
    if (!list && (propName === 'hs_lead_status' || propName === 'estado_del_lead')) {
      list = filterOptionsMap.hs_lead_status;
    }
    if (!list && propName === 'city') {
      list = filterOptionsMap.city;
    }

    if (!list || list.length <= 1) {
      const propDef = (availableHubSpotProps || []).find((p) => p.name === propName);
      if (propDef && (propDef as any).options && Array.isArray((propDef as any).options)) {
        const optValues = (propDef as any).options.map((o: any) => o.label || o.value);
        list = optValues;
      }
    }

    if (!list || list.length === 0) {
      return [];
    }

    const seen = new Set<string>();
    const result: string[] = [];
    for (const item of list) {
      if (
        item &&
        item !== '(Varios elementos)' &&
        item !== '(Todas)' &&
        item !== '(Todos)' &&
        !seen.has(item.toLowerCase())
      ) {
        seen.add(item.toLowerCase());
        result.push(item);
      }
    }
    return result;
  };

  // Helper para actualizar criterios principales de segmentación
  const handleUpdateFilterCriterion = (key: keyof HubSpotReportConfig['filters'], value: any) => {
    hasPendingChangesRef.current = true;
    setReportConfig((prevRaw) => {
      const prev = sanitizeReportConfig(prevRaw);
      return {
        ...prev,
        filters: {
          ...prev.filters,
          [key]: value,
        },
        updatedAt: new Date().toISOString(),
      };
    });
  };

  // Helper para restablecer filtros de origen
  const handleResetFiltersToAll = () => {
    hasPendingChangesRef.current = true;
    setReportConfig((prevRaw) => {
      const prev = sanitizeReportConfig(prevRaw);
      return {
        ...prev,
        filters: {
          campaign: '(Varios elementos)',
          filterValue: '(Varios elementos)',
          dateRange: 'last_365d',
          startDate: '',
          endDate: '',
          leadStatus: 'ALL',
          lifecycleStage: 'ALL',
          source: 'ALL',
          ownerId: 'ALL',
          customFilters: [],
        },
        updatedAt: new Date().toISOString(),
      };
    });
    setDateRange('last_365d');
    setFilterValue('(Todos)');
    setCampaign('(Todos)');
  };

  // Conteo dinámico de filtros activos
  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (reportConfig.filters?.ownerId && reportConfig.filters.ownerId !== 'ALL') count++;
    if (reportConfig.filters?.leadStatus && reportConfig.filters.leadStatus !== 'ALL') count++;
    if (reportConfig.filters?.lifecycleStage && reportConfig.filters.lifecycleStage !== 'ALL') count++;
    if (
      reportConfig.filters?.campaign &&
      reportConfig.filters.campaign !== 'ALL' &&
      reportConfig.filters.campaign !== '(Varios elementos)'
    )
      count++;
    if (reportConfig.filters?.source && reportConfig.filters.source !== 'ALL') count++;
    if (dateRange && dateRange !== 'ALL') count++;
    count += (reportConfig.filters?.customFilters || []).length;
    return count;
  }, [reportConfig.filters, dateRange]);

  // Etiqueta legible para rango de fechas
  const dateRangeLabel = useMemo(() => {
    switch (dateRange) {
      case 'last_365d':
      case 'last_year':
        return '📅 Último año (365 días)';
      case 'today':
        return '☀️ Registrados Hoy';
      case 'yesterday':
        return '⏱️ Ayer';
      case 'last_7d':
        return '🗓️ Últimos 7 días';
      case 'last_14d':
        return '📅 Últimas 2 semanas (14 días)';
      case 'last_30d':
        return '🗓️ Últimos 30 días';
      case 'current_month':
        return '📆 Mes actual calendario';
      case 'custom':
        return `📅 Personalizado (${startDate || '...'} a ${endDate || '...'})`;
      case 'ALL':
      default:
        return '🌟 Todo el histórico disponible';
    }
  }, [dateRange, startDate, endDate]);

  // Handlers para filtros de propiedades personalizadas
  const handleAddCustomFilter = () => {
    hasPendingChangesRef.current = true;
    const defaultProp = (availableHubSpotProps && availableHubSpotProps[0]?.name) || 'carrera_de_interes';
    const newRule: CustomPropertyFilter = {
      id: `flt_${Math.random().toString(36).substring(2, 9)}`,
      propertyName: defaultProp,
      operator: 'EQ',
      value: '',
    };
    setReportConfig((prevRaw) => {
      const prev = sanitizeReportConfig(prevRaw);
      const existing = prev.filters?.customFilters || [];
      return {
        ...prev,
        filters: {
          ...prev.filters,
          customFilters: [...existing, newRule],
        },
        updatedAt: new Date().toISOString(),
      };
    });
    setShowCustomFiltersSection(true);
  };

  const handleRemoveCustomFilter = (filterId: string) => {
    hasPendingChangesRef.current = true;
    setReportConfig((prevRaw) => {
      const prev = sanitizeReportConfig(prevRaw);
      const existing = prev.filters?.customFilters || [];
      return {
        ...prev,
        filters: {
          ...prev.filters,
          customFilters: existing.filter((f) => f.id !== filterId),
        },
        updatedAt: new Date().toISOString(),
      };
    });
  };

  const handleUpdateCustomFilter = (
    filterId: string,
    field: 'propertyName' | 'operator' | 'value',
    val: string,
  ) => {
    hasPendingChangesRef.current = true;
    setReportConfig((prevRaw) => {
      const prev = sanitizeReportConfig(prevRaw);
      const existing = prev.filters?.customFilters || [];
      return {
        ...prev,
        filters: {
          ...prev.filters,
          customFilters: existing.map((f) => {
            if (f.id === filterId) {
              return { ...f, [field]: val };
            }
            return f;
          }),
        },
        updatedAt: new Date().toISOString(),
      };
    });
  };

  const toggleRuleInputMode = (ruleId: string) => {
    setFreeTextFilterRuleIds((prev) => {
      const next = new Set(prev);
      if (next.has(ruleId)) {
        next.delete(ruleId);
      } else {
        next.add(ruleId);
      }
      return next;
    });
  };

  // Filter properties list for configuration view
  const filteredProperties = useMemo(() => {
    const list = Array.isArray(reportConfig?.selectedProperties)
      ? reportConfig.selectedProperties
      : DEFAULT_HUBSPOT_REPORT_PROPERTIES;

    // Merge in available properties not yet added to selectedProperties
    const currentNames = new Set(list.map((p) => p.name));
    const extraAvailable: HubSpotPropertyConfig[] = (availableHubSpotProps || [])
      .filter((ap) => ap && !currentNames.has(ap.name))
      .map((ap) => ({
        name: ap.name,
        label: ap.label,
        isCustom: ap.isCustom,
        type: ap.type,
        enabled: false,
      }));

    const combined = [...list, ...extraAvailable];

    return combined.filter((p) => {
      const matchKeyword =
        !propertyFilterKeyword ||
        p.name.toLowerCase().includes(propertyFilterKeyword.toLowerCase()) ||
        p.label.toLowerCase().includes(propertyFilterKeyword.toLowerCase());

      if (!matchKeyword) return false;

      if (propertyFilterCategory === 'selected') return p.enabled;
      if (propertyFilterCategory === 'standard') return !p.isCustom;
      if (propertyFilterCategory === 'custom') return p.isCustom;
      return true;
    });
  }, [reportConfig?.selectedProperties, availableHubSpotProps, propertyFilterKeyword, propertyFilterCategory]);

  const enabledCount = (reportConfig?.selectedProperties || []).filter((p) => p.enabled).length;

  const rowLabelDisplay = reportConfig?.pivotConfig?.rowFieldLabel || reportConfig?.pivotConfig?.rowLabel || 'FUENTE';
  const columnLabelDisplay = reportConfig?.pivotConfig?.columnFieldLabel || reportConfig?.pivotConfig?.columnLabel || 'Etapa del ciclo de vida';

  // Trigger report generation
  const handleGenerateReports = async (targetOwnerId?: string) => {
    const ownerToUse = targetOwnerId || selectedOwnerId || 'ALL';
    if (targetOwnerId) {
      setSelectedOwnerId(targetOwnerId);
    }
    setIsGenerating(true);
    setErrorNotice(null);
    setSuccessNotice(null);
    setCurrentStep('1. Consultando responsables activos en HubSpot API v3...');

    const token =
      typeof window !== 'undefined' ? localStorage.getItem('hubspot_token') || '' : '';

    try {
      setTimeout(() => {
        setCurrentStep('2. Extrayendo contactos con paginación cursor y reintentos HTTP 429...');
      }, 700);

      setTimeout(() => {
        setCurrentStep(
          `3. Construyendo archivo Excel .xlsx con ${enabledCount} campos y Matriz Cruzada (${rowLabelDisplay} vs ${columnLabelDisplay})...`,
        );
      }, 1600);

      if (sendEmail) {
        setTimeout(() => {
          setCurrentStep('4. Despachando archivo Excel adjunto por correo electrónico...');
        }, 2400);
      }

      const effectiveFilter = (filterValue || campaign || '(Varios elementos)').trim();
      const currentFilterField = reportConfig.pivotConfig.filterField || 'campana';
      const currentFilterFieldLabel = reportConfig.pivotConfig.filterFieldLabel || 'Seleccionar Campaña';

      const payload: any = {
        ownerId: ownerToUse,
        generateForAll: ownerToUse === 'ALL',
        sendEmail,
        campaign: effectiveFilter,
        filterField: currentFilterField,
        filterFieldLabel: currentFilterFieldLabel,
        filterValue: effectiveFilter,
        dateRange,
        startDate: dateRange === 'custom' ? startDate : undefined,
        endDate: dateRange === 'custom' ? endDate : undefined,
        reportConfig: {
          ...reportConfig,
          pivotConfig: {
            ...reportConfig.pivotConfig,
            filterField: currentFilterField,
            filterFieldLabel: currentFilterFieldLabel,
          },
          filters: {
            ...reportConfig.filters,
            campaign: effectiveFilter,
            filterValue: effectiveFilter,
            dateRange,
            startDate: dateRange === 'custom' ? startDate : undefined,
            endDate: dateRange === 'custom' ? endDate : undefined,
          },
        },
      };

      if (smtpHost && smtpUser && smtpPass) {
        payload.customSmtp = {
          host: smtpHost,
          port: smtpPort,
          user: smtpUser,
          pass: smtpPass,
          from: emailFrom,
        };
      }

      const res = await fetch('/api/reports/generate-excel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token ? `Bearer ${token}` : '',
        },
        body: JSON.stringify(payload),
      });

      const contentType = res.headers.get('content-type') || '';
      let data: any;
      if (contentType.includes('application/json')) {
        data = await res.json();
      } else {
        const text = await res.text();
        throw new Error(
          res.status === 413
            ? 'El volumen de la solicitud superó el límite del servidor. Por favor selecciona un responsable específico o reduce el rango de fechas.'
            : `El servidor devolvió un error (${res.status}): ${text.slice(0, 140)}`
        );
      }

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Error desconocido al generar reportes');
      }

      setGeneratedReports(data.reports || []);
      setSuccessNotice(data.summary || '¡Reportes generados exitosamente!');
      if (data.reports && data.reports.length > 0) {
        setExpandedMatrixReportId(data.reports[0].reportId);
      }
    } catch (err: any) {
      setErrorNotice(err.message || 'Error de conexión');
    } finally {
      setIsGenerating(false);
      setCurrentStep('');
    }
  };

  // Direct download trigger
  const handleDownload = (report: GeneratedReportItem) => {
    if (report.excelBase64) {
      const link = document.createElement('a');
      link.href = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${report.excelBase64}`;
      link.download = report.fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else {
      window.open(report.downloadUrl, '_blank');
    }
  };

  // Copy code execution snippet
  const handleCopySnippet = () => {
    navigator.clipboard.writeText(codeExecutionSnippet);
    setCopiedSnippet(true);
    setTimeout(() => setCopiedSnippet(false), 2500);
  };

  const codeExecutionSnippet = `/**
 * EJEMPLO DE EJECUCIÓN MODULAR: GENERACIÓN Y DISTRIBUCIÓN DE REPORTES HUBSPOT CRM EN EXCEL (.XLSX)
 * Configuración dinámica sincronizada con tabla companies.hubspot_report_config
 */

import { executeHubSpotReportGeneration } from './src/services/hubspotExcelReporter';

async function runReports() {
  const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN || 'pat-na1-...';

  // Configuración de reporte (tabla companies)
  const reportConfig = ${JSON.stringify(reportConfig, null, 2)};

  console.log('--- Generando reporte Excel con configuración dinámica ---');
  const result = await executeHubSpotReportGeneration(HUBSPOT_TOKEN, {
    ownerId: 'owner_101',              // O pasar 'ALL' con generateForAll: true
    generateForAll: false,
    sendEmail: true,                   // Despacha a cada asesor a su email de HubSpot
    campaign: '${campaign}',
    dateRange: '${dateRange}',
    reportConfig,                      // Estructura de campos y tabla dinámica
  });

  console.log(result.summary);
  console.log('Archivo generado:', result.results[0]?.fileName);
}

runReports().catch(console.error);`;

  return (
    <div
      className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden"
      id="hubspot-excel-reporter-module"
    >
      {/* Module Header */}
      <div className="p-5 border-b border-slate-200 bg-gradient-to-r from-slate-50 via-indigo-50/20 to-white flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md bg-indigo-50 text-indigo-700 text-xs font-semibold uppercase tracking-wider mb-1.5">
            <FileSpreadsheet className="w-3.5 h-3.5 text-indigo-600" />
            Automatización CRM &amp; Distribución Excel
          </div>
          <h3 className="text-lg font-bold text-slate-900 tracking-tight">
            Generador y Distribuidor de Reportes Excel (.xlsx) CRM
          </h3>
          <p className="text-xs text-slate-600 mt-0.5">
            Reportes dinámicos de HubSpot API v3 con estructura y matriz cruzada personalizables para tu organización.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Tab Navigation Pill Buttons */}
          <div className="flex items-center bg-slate-100 p-1 rounded-lg border border-slate-200">
            <button
              type="button"
              onClick={() => setActiveTab('config')}
              className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'config'
                  ? 'bg-white text-indigo-700 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Configurar Columnas &amp; Matriz</span>
              <span className="bg-indigo-100 text-indigo-800 text-[10px] px-1.5 py-0.2 rounded-full font-mono">
                {enabledCount}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('generator')}
              className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'generator'
                  ? 'bg-white text-indigo-700 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Generador</span>
            </button>
          </div>
        </div>
      </div>

      {/* Sync Status Banner */}
      <div className="px-5 py-2 bg-indigo-50/50 border-b border-indigo-100 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2 text-slate-600">
          <Database className="w-3.5 h-3.5 text-indigo-600" />
          <span>
            Estado: <strong className="text-slate-800">Sincronización activa</strong>
          </span>
          <span className="text-slate-400">•</span>
          <span className="text-indigo-900 font-medium">
            Matriz: <strong>{rowLabelDisplay}</strong> (Filas) vs{' '}
            <strong>{columnLabelDisplay}</strong> (Columnas)
          </span>
          <span className="text-slate-400">•</span>
          <span className="text-indigo-800 font-bold bg-indigo-100/80 px-2 py-0.5 rounded text-[11px] inline-flex items-center gap-1">
            <span className="text-indigo-600 font-mono">{reportConfig.pivotConfig.aggregator || 'COUNT'}:</span>
            <span>{reportConfig.pivotConfig.metricLabel}</span>
          </span>
          <span className="text-slate-400">•</span>
          <span>{enabledCount} columnas en Hoja 2</span>
        </div>

        <div className="flex items-center gap-2">
          {isSavingConfig && (
            <span className="text-indigo-600 text-[11px] flex items-center gap-1 font-medium">
              <RefreshCw className="w-3 h-3 animate-spin" />
              Sincronizando con BD...
            </span>
          )}
          {saveSuccessMessage && (
            <span className="text-emerald-700 bg-emerald-100/80 px-2 py-0.5 rounded text-[11px] font-medium flex items-center gap-1">
              <Check className="w-3 h-3 text-emerald-600" />
              {saveSuccessMessage}
            </span>
          )}
          <button
            type="button"
            onClick={handleManualSaveConfig}
            disabled={isSavingConfig}
            className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-700 hover:text-indigo-900 bg-indigo-100/70 hover:bg-indigo-100 px-2 py-1 rounded transition-colors cursor-pointer"
          >
            <Save className="w-3 h-3" />
            <span>Guardar Configuración</span>
          </button>
        </div>
      </div>

      {/* TAB 1: GENERATOR & DISPATCH (SOLO INFORMATIVO + GENERAR PARA TODOS) */}
      {activeTab === 'generator' && (
        <>
          <div className="p-5 border-b border-slate-200 bg-slate-50/60 space-y-4">
            {/* Header info */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-sm shrink-0">
                  <FileSpreadsheet className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-bold text-slate-900 text-sm sm:text-base flex items-center gap-2">
                    <span>Estructura del Archivo Excel (.xlsx) y Generador</span>
                    <span className="text-[10px] font-semibold text-indigo-800 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-full">
                      Solo Informativo
                    </span>
                  </h4>
                  <p className="text-xs text-slate-500">
                    Revisa cómo se generará el libro de Excel con los campos y filtros configurados, y ejecuta la generación masiva para todos los asesores.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setActiveTab('config')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-indigo-200 bg-white hover:bg-indigo-50 text-indigo-700 text-xs font-bold transition-colors cursor-pointer shadow-2xs"
                  title="Ir a modificar la configuración de columnas, matriz y filtros"
                >
                  <Sliders className="w-3.5 h-3.5 text-indigo-600" />
                  <span>Configurar Columnas &amp; Matriz</span>
                </button>
              </div>
            </div>

            {/* Informative Structure Cards Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 text-xs">
              {/* Card 1: Hoja 1 - Tabla Dinámica / Matriz Cruzada */}
              <div className="bg-white rounded-xl border border-indigo-100 shadow-2xs p-4 flex flex-col justify-between space-y-3">
                <div>
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2 mb-2.5">
                    <span className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                      <Table className="w-4 h-4 text-indigo-600" />
                      Hoja 1: Tabla Dinámica / Matriz
                    </span>
                    <span className="text-[10px] bg-indigo-50 text-indigo-700 font-mono font-bold px-1.5 py-0.5 rounded border border-indigo-200">
                      Celda A1:Z100
                    </span>
                  </div>

                  <ul className="space-y-2 text-slate-700">
                    <li className="flex items-start justify-between gap-2">
                      <span className="text-slate-500 font-medium">Filtro Interactivo (A1:B1):</span>
                      <span className="font-bold text-slate-900 text-right">
                        {reportConfig.pivotConfig.filterFieldLabel || reportConfig.pivotConfig.filterField || 'Campaña'} = <span className="text-indigo-600 font-mono font-bold">[{filterValue || reportConfig.filters?.filterValue || '(Todos)'}]</span>
                      </span>
                    </li>
                    <li className="flex items-start justify-between gap-2">
                      <span className="text-slate-500 font-medium flex items-center gap-1">
                        <ArrowDown className="w-3 h-3 text-indigo-600" />
                        Campo en Filas (Celda A3):
                      </span>
                      <span className="font-bold text-slate-900 text-right">
                        {rowLabelDisplay} <span className="text-[10px] font-mono text-slate-400 font-normal">({reportConfig.pivotConfig.rowField})</span>
                      </span>
                    </li>
                    <li className="flex items-start justify-between gap-2">
                      <span className="text-slate-500 font-medium flex items-center gap-1">
                        <ArrowUp className="w-3 h-3 text-indigo-600 rotate-90" />
                        Campo en Columnas (Celda B2):
                      </span>
                      <span className="font-bold text-slate-900 text-right">
                        {columnLabelDisplay} <span className="text-[10px] font-mono text-slate-400 font-normal">({reportConfig.pivotConfig.columnField})</span>
                      </span>
                    </li>
                    <li className="flex items-start justify-between gap-2">
                      <span className="text-slate-500 font-medium">Función &amp; Métrica (Celda A2):</span>
                      <span className="font-bold text-slate-900 text-right">
                        <span className="bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded font-mono text-[10px] mr-1 font-bold">
                          {reportConfig.pivotConfig.aggregator || 'COUNT'}
                        </span>
                        {reportConfig.pivotConfig.metricLabel}
                      </span>
                    </li>
                  </ul>
                </div>

                <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                  <span>Fórmulas automáticas:</span>
                  <span className="font-mono text-indigo-700 font-semibold">=COUNTIFS(...) dinámico</span>
                </div>
              </div>

              {/* Card 2: Hoja 2 - Contactos Registrados */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-2xs p-4 flex flex-col justify-between space-y-3">
                <div>
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2 mb-2.5">
                    <span className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                      <Layers className="w-4 h-4 text-emerald-600" />
                      Hoja 2: Contactos (Base Detallada)
                    </span>
                    <span className="text-[10px] bg-emerald-50 text-emerald-700 font-mono font-bold px-1.5 py-0.5 rounded border border-emerald-200">
                      {enabledCount} Columnas
                    </span>
                  </div>

                  <p className="text-[11px] text-slate-500 mb-1.5">
                    Columnas activas que se incluirán ordenadas en la fila 1:
                  </p>

                  <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto pr-1">
                    {(reportConfig.selectedProperties || [])
                      .filter((p) => p.enabled)
                      .slice(0, 10)
                      .map((p) => (
                        <span
                          key={p.name}
                          className="text-[10px] bg-slate-100 text-slate-700 border border-slate-200 px-1.5 py-0.5 rounded font-medium"
                          title={`${p.label} (${p.name})`}
                        >
                          {p.label}
                        </span>
                      ))}
                    {enabledCount > 10 && (
                      <span className="text-[10px] bg-indigo-50 text-indigo-700 border border-indigo-200 px-1.5 py-0.5 rounded font-bold">
                        +{enabledCount - 10} más...
                      </span>
                    )}
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                  <span>Contactos incluidos:</span>
                  <span className="text-slate-800 font-medium">Asignados al asesor con filtros</span>
                </div>
              </div>

              {/* Card 3: Filtros Globales y Segmentación */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-2xs p-4 flex flex-col justify-between space-y-3">
                <div>
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2 mb-2.5">
                    <span className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                      <Filter className="w-4 h-4 text-amber-600" />
                      Filtros y Segmentación Seleccionados
                    </span>
                    <span className="text-[10px] bg-amber-50 text-amber-800 font-bold px-1.5 py-0.5 rounded border border-amber-200">
                      {activeFiltersCount} Activo{activeFiltersCount !== 1 ? 's' : ''}
                    </span>
                  </div>

                  <ul className="space-y-1.5 text-[11px] text-slate-600">
                    <li className="flex items-center justify-between">
                      <span className="text-slate-500">Fecha de Creación:</span>
                      <span className="font-semibold text-slate-900">{dateRangeLabel}</span>
                    </li>
                    <li className="flex items-center justify-between">
                      <span className="text-slate-500">Estado del Lead:</span>
                      <span className="font-semibold text-slate-900">
                        {reportConfig.filters?.leadStatus && reportConfig.filters.leadStatus !== 'ALL'
                          ? reportConfig.filters.leadStatus
                          : 'Todos los Estados'}
                      </span>
                    </li>
                    <li className="flex items-center justify-between">
                      <span className="text-slate-500">Etapa del Ciclo:</span>
                      <span className="font-semibold text-slate-900">
                        {reportConfig.filters?.lifecycleStage && reportConfig.filters.lifecycleStage !== 'ALL'
                          ? reportConfig.filters.lifecycleStage
                          : 'Todas las Etapas'}
                      </span>
                    </li>
                    <li className="flex items-center justify-between">
                      <span className="text-slate-500">Canal / Fuente:</span>
                      <span className="font-semibold text-slate-900">
                        {reportConfig.filters?.source && reportConfig.filters.source !== 'ALL'
                          ? reportConfig.filters.source
                          : 'Todos los Canales'}
                      </span>
                    </li>
                    <li className="flex items-center justify-between">
                      <span className="text-slate-500">Reglas Personalizadas:</span>
                      <span className="font-semibold text-slate-900">
                        {(reportConfig.filters?.customFilters || []).length > 0
                          ? `${(reportConfig.filters?.customFilters || []).length} regla(s) guardada(s)`
                          : 'Sin reglas adicionales'}
                      </span>
                    </li>
                  </ul>
                </div>

                <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px]">
                  <span className="text-slate-500">Despacho por email:</span>
                  <span className={sendEmail ? 'font-bold text-emerald-700' : 'text-slate-500'}>
                    {sendEmail ? '✓ Activo' : 'Solo descarga'}
                  </span>
                </div>
              </div>
            </div>

            {/* Execution Panel: Solo la opción de generar reporte para todos */}
            <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 rounded-xl p-4 sm:p-5 text-white shadow-md flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="space-y-1 text-center md:text-left">
                <div className="flex items-center justify-center md:justify-start gap-2">
                  <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                    Listo para Generar
                  </span>
                  <span className="text-xs text-indigo-200">
                    Estructura validada y lista para compilar
                  </span>
                </div>
                <h5 className="font-bold text-sm sm:text-base text-white">
                  Generación de Reportes Excel CRM para Asesores Comerciales
                </h5>
                <p className="text-xs text-slate-300 max-w-xl">
                  Se iterará sobre los <strong className="text-white">{(owners || []).length} asesores activos</strong> en tu portal de HubSpot CRM, creando un archivo .xlsx individualizado para cada uno con la matriz cruzada y sus contactos asignados.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row items-center gap-3 shrink-0 w-full md:w-auto">
                {/* Email dispatch toggle */}
                <label className="inline-flex items-center gap-2 cursor-pointer bg-white/10 hover:bg-white/15 px-3 py-2 rounded-lg text-xs transition-colors border border-white/10 select-none">
                  <input
                    type="checkbox"
                    checked={sendEmail}
                    onChange={(e) => {
                      const val = e.target.checked;
                      setSendEmail(val);
                      hasPendingChangesRef.current = true;
                      setReportConfig((prev) => ({
                        ...prev,
                        sendEmailDefault: val,
                      }));
                    }}
                    className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer"
                  />
                  <span className="text-slate-200 font-medium">Enviar copia por Correo</span>
                </label>

                {/* Primary Action Button: Generar Reporte para Todos */}
                <button
                  type="button"
                  onClick={() => handleGenerateReports('ALL')}
                  disabled={isGenerating}
                  className="w-full sm:w-auto bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 active:from-emerald-700 active:to-teal-700 text-white font-extrabold text-sm py-2.5 px-6 rounded-lg shadow-lg hover:shadow-emerald-500/25 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-4 h-4 ${isGenerating ? 'animate-spin' : ''}`} />
                  <span>
                    {isGenerating
                      ? 'Generando Reportes...'
                      : '🚀 Generar Reporte para Todos'}
                  </span>
                </button>
              </div>
            </div>

            {/* Live Generation Progress Indicator */}
            {isGenerating && (
              <div className="mt-4 p-3 bg-indigo-50 border border-indigo-200 rounded-lg flex items-center gap-3">
                <RefreshCw className="w-5 h-5 text-indigo-600 animate-spin shrink-0" />
                <div className="flex-1">
                  <div className="flex items-center justify-between text-xs font-semibold text-indigo-900 mb-1">
                    <span>{currentStep}</span>
                    <span className="font-mono text-[10px] text-indigo-600">Procesando CRM...</span>
                  </div>
                  <div className="w-full bg-indigo-200 h-1.5 rounded-full overflow-hidden">
                    <div className="bg-indigo-600 h-1.5 rounded-full animate-pulse w-3/4" />
                  </div>
                </div>
              </div>
            )}

            {/* Success or Error Notice */}
            {successNotice && (
              <div className="mt-4 p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-lg font-medium flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>{successNotice}</span>
                </div>
                <button
                  onClick={() => setSuccessNotice(null)}
                  className="text-xs text-emerald-700 hover:text-emerald-900 font-semibold cursor-pointer"
                >
                  ×
                </button>
              </div>
            )}

            {errorNotice && (
              <div className="mt-4 p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-lg font-medium flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{errorNotice}</span>
                </div>
                <button
                  onClick={() => setErrorNotice(null)}
                  className="text-xs text-rose-700 hover:text-rose-900 font-semibold cursor-pointer"
                >
                  ×
                </button>
              </div>
            )}
          </div>

          {/* Generated Reports & Live Excel Matrix Explorer */}
          <div className="p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Table className="w-4 h-4 text-indigo-600" />
                <h4 className="text-sm font-bold text-slate-900 uppercase tracking-wide">
                  Reportes Excel Generados &amp; Auditoría de Envíos
                </h4>
              </div>
              <span className="text-xs text-slate-500 font-medium">
                {generatedReports.length}{' '}
                {generatedReports.length === 1 ? 'reporte disponible' : 'reportes disponibles'}
              </span>
            </div>

            {generatedReports.length === 0 ? (
              <div className="text-center py-10 bg-slate-50/50 rounded-xl border border-dashed border-slate-200">
                <FileSpreadsheet className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                <p className="text-xs font-semibold text-slate-700">
                  Aún no se han generado reportes en esta sesión
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Selecciona un responsable o "Todos los responsables" y pulsa "Generar Reporte Excel".
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {(generatedReports || []).map((report) => {
                  const isExpanded = expandedMatrixReportId === report.reportId;
                  const matrix = report.matrixSummary;
                  const rowLabelActive = matrix?.pivotConfig?.rowFieldLabel || reportConfig?.pivotConfig?.rowFieldLabel || 'FUENTE';
                  const colLabelActive = matrix?.pivotConfig?.columnFieldLabel || reportConfig?.pivotConfig?.columnFieldLabel || 'Etapa del ciclo de vida';
                  const metricLabelActive = matrix?.pivotConfig?.metricLabel || reportConfig?.pivotConfig?.metricLabel || 'Cuenta';
                  const aggActive = matrix?.pivotConfig?.aggregator || reportConfig?.pivotConfig?.aggregator || 'COUNT';

                  // Dynamic client-side filtering if report contacts are available
                  const activeFilterValue = (filterValue || '(Todos)').trim();
                  const isAllFilterSelected =
                    !activeFilterValue ||
                    activeFilterValue === '(Varios elementos)' ||
                    activeFilterValue === '(Todas)' ||
                    activeFilterValue === '(Todos)' ||
                    activeFilterValue === 'ALL' ||
                    activeFilterValue === '*';

                  let columnHeaders = matrix?.columnHeaders || [];
                  let rowHeaders = matrix?.rowHeaders || [];
                  let grid = matrix?.grid || {};
                  let rowTotals = matrix?.rowTotals || {};
                  let columnTotals = matrix?.columnTotals || {};
                  let grandTotal = matrix?.grandTotal || 0;
                  let filteredCount = report.totalContacts;

                  if (report.contacts && Array.isArray(report.contacts) && report.contacts.length > 0) {
                    const rowF = reportConfig?.pivotConfig?.rowField || 'fuente';
                    const colF = reportConfig?.pivotConfig?.columnField || 'lifecyclestage';
                    const fltF = currentFilterField;
                    const agg = aggActive;
                    const metF = reportConfig?.pivotConfig?.metricField || 'num_notes';

                    const matchingContacts = isAllFilterSelected
                      ? report.contacts
                      : report.contacts.filter((c: any) => {
                          const val = extractFieldValue(c, fltF);
                          return String(val).toLowerCase().trim() === activeFilterValue.toLowerCase().trim();
                        });

                    filteredCount = matchingContacts.length;

                    // Ensure all row and column headers are discovered from the dataset
                    const dynRows = new Set<string>();
                    const dynCols = new Set<string>();
                    for (const c of report.contacts) {
                      dynRows.add(extractFieldValue(c, rowF) || 'Sin especificar');
                      dynCols.add(extractFieldValue(c, colF) || 'Sin clasificar');
                    }
                    rowHeaders = Array.from(dynRows).sort((a, b) => a.localeCompare(b));
                    if (rowHeaders.length === 0) rowHeaders = ['General'];
                    columnHeaders = Array.from(dynCols).sort((a, b) => a.localeCompare(b));
                    if (columnHeaders.length === 0) columnHeaders = ['Total'];

                    const newGrid: Record<string, Record<string, number>> = {};
                    const newRowTotals: Record<string, number> = {};
                    const newColTotals: Record<string, number> = {};
                    let newGrand = 0;

                    for (const r of rowHeaders) {
                      newGrid[r] = {};
                      newRowTotals[r] = 0;
                      for (const col of columnHeaders) {
                        newGrid[r][col] = 0;
                      }
                    }
                    for (const col of columnHeaders) {
                      newColTotals[col] = 0;
                    }

                    for (const c of matchingContacts) {
                      const r = extractFieldValue(c, rowF) || 'Sin especificar';
                      const col = extractFieldValue(c, colF) || 'Sin clasificar';
                      let num = 1;
                      if (agg === 'SUM' || agg === 'AVG') {
                        const raw = extractFieldValue(c, metF);
                        num = parseFloat(String(raw).replace(/,/g, '')) || 0;
                      }

                      if (!newGrid[r]) newGrid[r] = {};
                      newGrid[r][col] = (newGrid[r][col] || 0) + num;
                      newRowTotals[r] = (newRowTotals[r] || 0) + num;
                      newColTotals[col] = (newColTotals[col] || 0) + num;
                      newGrand += num;
                    }

                    grid = newGrid;
                    rowTotals = newRowTotals;
                    columnTotals = newColTotals;
                    grandTotal = newGrand;
                  }

                  const formatCellValue = (val: number | undefined) => {
                    if (val === undefined || val === null) return '-';
                    if (val === 0 && (aggActive === 'COUNT' || aggActive === 'SUM')) return '-';
                    return typeof val === 'number' && !Number.isInteger(val) ? val.toFixed(2) : String(val);
                  };

                  return (
                    <div
                      key={report.reportId}
                      className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-2xs hover:border-slate-300 transition-all"
                    >
                      {/* Report Card Header */}
                      <div className="p-4 bg-slate-50/70 border-b border-slate-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold">
                            <FileSpreadsheet className="w-5 h-5" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-900 text-sm">{report.fileName}</span>
                              <span className="text-[10px] font-mono bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded">
                                {report.totalContacts} contactos
                              </span>
                            </div>
                            <div className="text-slate-500 text-[11px] flex items-center gap-2 mt-0.5">
                              <span>
                                Responsable: <strong className="text-slate-700">{report.ownerName}</strong>
                              </span>
                              <span>•</span>
                              <span>{report.ownerEmail || 'Sin email'}</span>
                              <span>•</span>
                              <span>Hora: {report.generatedAt}</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                          {/* Email Status Badge */}
                          {report.emailSent ? (
                            <span
                              title={report.emailMessage || 'Correo entregado'}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200"
                            >
                              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                              {report.emailStatus === 'simulated' ? 'Email Simulado OK' : 'Email Entregado'}
                            </span>
                          ) : report.emailStatus === 'failed' ? (
                            <span
                              title={report.emailMessage || 'Fallo de entrega'}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200"
                            >
                              <AlertCircle className="w-3 h-3 text-rose-600" />
                              Fallo de Correo
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-600">
                              Solo Descarga
                            </span>
                          )}

                          {/* Download Button */}
                          <button
                            type="button"
                            onClick={() => handleDownload(report)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold text-xs shadow-2xs transition-colors cursor-pointer"
                          >
                            <Download className="w-3.5 h-3.5" />
                            Descargar .xlsx
                          </button>

                          {/* Toggle Matrix Preview */}
                          {matrix && (
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedMatrixReportId(isExpanded ? null : report.reportId)
                              }
                              className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg border border-slate-200 transition-colors cursor-pointer"
                              title={isExpanded ? 'Contraer vista previa' : 'Ver Matriz Cruzada (Hoja 1)'}
                            >
                              {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Matrix Preview for Sheet 1 */}
                      {isExpanded && matrix && (
                        <div className="p-4 bg-white border-t border-slate-100">
                          <div className="flex items-center justify-between mb-3 text-xs">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-slate-800">
                                Vista Previa de Hoja 1: Matriz Cruzada ({report.periodName})
                              </span>
                              <span className="text-[10px] bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded font-mono font-bold flex items-center gap-1">
                                <Filter className="w-3 h-3 text-indigo-600" />
                                {reportConfig.pivotConfig.filterFieldLabel || 'Filtro'}: {activeFilterValue} ({filteredCount} de {report.totalContacts} contactos)
                              </span>
                              <span className="text-[10px] bg-slate-100 text-slate-700 px-2 py-0.5 rounded font-medium">
                                {rowLabelDisplay} vs {columnLabelDisplay}
                              </span>
                              <span className="text-[10px] bg-emerald-50 text-emerald-800 border border-emerald-200 px-2 py-0.5 rounded font-mono font-bold">
                                {aggActive}: {metricLabelActive}
                              </span>
                            </div>
                            <span className="text-[11px] text-slate-500">
                              Hoja visible activa por defecto al abrir el archivo Excel
                            </span>
                          </div>

                          <div className="overflow-x-auto border border-slate-200 rounded-lg">
                            <table className="w-full text-xs text-left border-collapse">
                              <thead>
                                {/* Row 1 header in Excel */}
                                <tr className="bg-slate-100 border-b border-slate-200 text-slate-700 font-semibold text-[11px]">
                                  <th className="py-2 px-3 border-r border-slate-200 bg-slate-200/70">
                                    {metricLabelActive} ({aggActive})
                                  </th>
                                  <th
                                    colSpan={columnHeaders.length + 1}
                                    className="py-2 px-3 text-center bg-indigo-50 text-indigo-900 font-bold"
                                  >
                                    Etiquetas de columna ({colLabelActive})
                                  </th>
                                </tr>
                                {/* Row 2 headers */}
                                <tr className="bg-slate-50 border-b border-slate-200 text-slate-800 font-bold text-[11px]">
                                  <th className="py-2 px-3 border-r border-slate-200">
                                    Etiquetas de fila ({rowLabelActive})
                                  </th>
                                  {columnHeaders.map((col) => (
                                    <th
                                      key={col}
                                      className="py-2 px-3 text-center border-r border-slate-200 bg-indigo-50/50"
                                    >
                                      {col}
                                    </th>
                                  ))}
                                  <th className="py-2 px-3 text-right bg-slate-200 font-black text-slate-900">
                                    Total general
                                  </th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {rowHeaders.map((rowKey) => (
                                  <tr key={rowKey} className="hover:bg-slate-50/80">
                                    <td className="py-2 px-3 font-semibold text-slate-800 border-r border-slate-200 bg-slate-50/30">
                                      {rowKey}
                                    </td>
                                    {columnHeaders.map((col) => {
                                      const val = grid[rowKey]?.[col];
                                      return (
                                        <td
                                          key={col}
                                          className="py-2 px-3 text-center border-r border-slate-200 font-mono text-slate-700"
                                        >
                                          {formatCellValue(val)}
                                        </td>
                                      );
                                    })}
                                    <td className="py-2 px-3 text-right font-bold text-slate-900 bg-slate-100 font-mono">
                                      {formatCellValue(rowTotals[rowKey])}
                                    </td>
                                  </tr>
                                ))}
                                {/* Total general row */}
                                <tr className="bg-slate-100/90 font-bold border-t-2 border-slate-300 text-slate-900">
                                  <td className="py-2.5 px-3 border-r border-slate-200 font-black">
                                    Total general
                                  </td>
                                  {columnHeaders.map((col) => (
                                    <td
                                      key={col}
                                      className="py-2.5 px-3 text-center border-r border-slate-200 font-mono font-black"
                                    >
                                      {formatCellValue(columnTotals[col])}
                                    </td>
                                  ))}
                                  <td className="py-2.5 px-3 text-right font-black text-indigo-700 bg-indigo-100/80 font-mono text-sm">
                                    {formatCellValue(grandTotal)}
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                          </div>

                          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
                            <span className="flex items-center gap-1 text-slate-600">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                              Hoja 2 <strong>"Contactos"</strong> incluye los{' '}
                              {report.totalContacts} registros con las {enabledCount} columnas configuradas.
                            </span>
                            <button
                              type="button"
                              onClick={() => handleDownload(report)}
                              className="text-indigo-600 hover:underline font-semibold cursor-pointer"
                            >
                              Descargar archivo completo (.xlsx)
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* TAB 2: CONFIGURATION EDITOR (hubspot_report_config in companies table) */}
      {activeTab === 'config' && (
        <div className="p-5 space-y-6">
          {/* Header Explanation */}
          <div className="bg-indigo-50/70 border border-indigo-200 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <h4 className="text-sm font-bold text-indigo-950 flex items-center gap-2">
                <Database className="w-4 h-4 text-indigo-600" />
                Configuración de Reportes y Tabla Dinámica
              </h4>
              <p className="text-xs text-indigo-800/90 leading-relaxed">
                Personaliza qué campos (estándar y creados a medida en HubSpot CRM) se exportan en la base detallada, qué campos cruzar en la <strong>Tabla Dinámica (Hoja 1)</strong>, y qué filtros aplicar por defecto. Toda modificación se guarda y sincroniza automáticamente.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleResetToDefault}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
                <span>21 Campos Estándar</span>
              </button>
              <button
                type="button"
                onClick={handleManualSaveConfig}
                disabled={isSavingConfig}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-2xs transition-colors cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{isSavingConfig ? 'Guardando...' : 'Guardar Configuración'}</span>
              </button>
            </div>
          </div>

          {/* Section 1: Dynamic Pivot Table Matrix Config (Sheet 1) */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-2xs space-y-4">
            <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
              <div>
                <h5 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Table className="w-4 h-4 text-indigo-600" />
                  1. Configuración de la Tabla Dinámica / Matriz Cruzada (Hoja 1)
                </h5>
                <p className="text-xs text-slate-500 mt-0.5">
                  Define qué propiedades de contacto construirán los ejes de Filas y Columnas en la primera pestaña del archivo Excel.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3.5 text-xs">
              {/* Row Field */}
              <div className="bg-slate-50 p-3.5 rounded-lg border border-slate-200 space-y-2.5">
                <label className="block font-bold text-slate-800">
                  1. Campo en FILAS (Row Field)
                </label>
                <select
                  value={reportConfig.pivotConfig.rowField}
                  onChange={(e) => handleUpdatePivotConfig('rowField', e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-md px-2.5 py-1.5 text-xs text-slate-800 font-medium focus:ring-2 focus:ring-indigo-500 focus:outline-none shadow-2xs"
                >
                  <option value="fuente">fuente (FUENTE)</option>
                  <option value="lifecyclestage">lifecyclestage (Etapa del ciclo de vida)</option>
                  <option value="hs_lead_status">hs_lead_status (Estado del lead)</option>
                  <option value="campana">campana (Campaña)</option>
                  <option value="carrera_de_interes">carrera_de_interes (Carrera de Interés)</option>
                  <option value="hubspot_owner_id">hubspot_owner_id (Propietario del contacto)</option>
                  <option value="city">city (Ciudad)</option>
                  <option value="industry">industry (Industria)</option>
                  {(reportConfig?.selectedProperties || [])
                    .filter((p) => !['fuente', 'lifecyclestage', 'hs_lead_status', 'campana', 'carrera_de_interes', 'hubspot_owner_id', 'city', 'industry'].includes(p.name))
                    .map((p) => (
                      <option key={p.name} value={p.name}>
                        {p.name} ({p.label})
                      </option>
                    ))}
                </select>
                <div>
                  <label className="block text-[10px] text-slate-500 font-medium mb-1">
                    Etiqueta visible en celda A3:
                  </label>
                  <input
                    type="text"
                    value={reportConfig.pivotConfig.rowFieldLabel || ''}
                    onChange={(e) => handleUpdatePivotConfig('rowFieldLabel', e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-xs"
                    placeholder="Ej. FUENTE"
                  />
                </div>
              </div>

              {/* Column Field */}
              <div className="bg-slate-50 p-3.5 rounded-lg border border-slate-200 space-y-2.5">
                <label className="block font-bold text-slate-800">
                  2. Campo en COLUMNAS (Column Field)
                </label>
                <select
                  value={reportConfig.pivotConfig.columnField}
                  onChange={(e) => handleUpdatePivotConfig('columnField', e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-md px-2.5 py-1.5 text-xs text-slate-800 font-medium focus:ring-2 focus:ring-indigo-500 focus:outline-none shadow-2xs"
                >
                  <option value="lifecyclestage">lifecyclestage (Etapa del ciclo de vida)</option>
                  <option value="hs_lead_status">hs_lead_status (Estado del lead)</option>
                  <option value="fuente">fuente (FUENTE)</option>
                  <option value="campana">campana (Campaña)</option>
                  <option value="carrera_de_interes">carrera_de_interes (Carrera de Interés)</option>
                  <option value="hubspot_owner_id">hubspot_owner_id (Propietario del contacto)</option>
                  {(reportConfig?.selectedProperties || [])
                    .filter((p) => !['lifecyclestage', 'hs_lead_status', 'fuente', 'campana', 'carrera_de_interes', 'hubspot_owner_id'].includes(p.name))
                    .map((p) => (
                      <option key={p.name} value={p.name}>
                        {p.name} ({p.label})
                      </option>
                    ))}
                </select>
                <div>
                  <label className="block text-[10px] text-slate-500 font-medium mb-1">
                    Etiqueta visible en celda B2:
                  </label>
                  <input
                    type="text"
                    value={reportConfig.pivotConfig.columnFieldLabel || ''}
                    onChange={(e) => handleUpdatePivotConfig('columnFieldLabel', e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-xs"
                    placeholder="Ej. Etapa del ciclo de vida"
                  />
                </div>
              </div>

              {/* Report Filter Field (A1:B1) */}
              <div className="bg-slate-50 p-3.5 rounded-lg border border-slate-200 space-y-2.5">
                <label className="block font-bold text-slate-800">
                  3. Campo de FILTRO (Celda A1:B1)
                </label>
                <select
                  value={reportConfig.pivotConfig.filterField || 'campana'}
                  onChange={(e) => handleFilterPropertyChange(e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-md px-2.5 py-1.5 text-xs text-slate-800 font-medium focus:ring-2 focus:ring-indigo-500 focus:outline-none shadow-2xs"
                >
                  <optgroup label="Campos Principales">
                    <option value="campana">campana (Campaña)</option>
                    <option value="carrera_de_interes">carrera_de_interes (Carrera de Interés)</option>
                    <option value="fuente">fuente (FUENTE)</option>
                    <option value="createdate">createdate (Fecha de creación)</option>
                    <option value="lifecyclestage">lifecyclestage (Etapa del ciclo de vida)</option>
                    <option value="hs_lead_status">hs_lead_status (Estado del lead)</option>
                    <option value="hubspot_owner_id">hubspot_owner_id (Propietario del contacto)</option>
                    <option value="city">city (Ciudad)</option>
                  </optgroup>
                  <optgroup label="Otras Propiedades Activas">
                    {(reportConfig?.selectedProperties || [])
                      .filter((p) => !['campana', 'carrera_de_interes', 'fuente', 'createdate', 'lifecyclestage', 'hs_lead_status', 'hubspot_owner_id', 'city'].includes(p.name))
                      .map((p) => (
                        <option key={p.name} value={p.name}>
                          {p.name} ({p.label})
                        </option>
                      ))}
                  </optgroup>
                </select>

                <div>
                  <label className="block text-[10px] text-slate-500 font-medium mb-1">
                    Etiqueta visible en celda A1:
                  </label>
                  <input
                    type="text"
                    value={reportConfig.pivotConfig.filterFieldLabel || ''}
                    onChange={(e) => handleUpdatePivotConfig('filterFieldLabel', e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-xs text-slate-800 font-medium focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                    placeholder="Ej. Seleccionar Campaña"
                  />
                </div>

                <div>
                  <label className="block text-[10px] text-slate-500 font-medium mb-1">
                    Valor predeterminado en celda B1:
                  </label>
                  {!isManualFilterInput ? (
                    <div className="flex items-center gap-1">
                      <select
                        value={availableOptionsForCurrentField.includes(filterValue) ? filterValue : '__CUSTOM__'}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === '__CUSTOM__') {
                            setIsManualFilterInput(true);
                          } else {
                            setFilterValue(val);
                            setCampaign(val);
                            hasPendingChangesRef.current = true;
                            setReportConfig((prev) => ({
                              ...prev,
                              filters: { ...prev.filters, campaign: val, filterValue: val },
                            }));
                          }
                        }}
                        className="w-full bg-white border border-indigo-300 rounded px-2 py-1 text-xs text-slate-900 font-bold focus:ring-2 focus:ring-indigo-500 focus:outline-none shadow-2xs"
                      >
                        {availableOptionsForCurrentField.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                        <option value="__CUSTOM__">✏️ Escribir valor libre...</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => setIsManualFilterInput(true)}
                        className="p-1 text-slate-400 hover:text-indigo-600 bg-white border border-slate-200 rounded transition-colors cursor-pointer shrink-0"
                        title="Escribir texto manual libre"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    <div className="relative flex items-center">
                      <input
                        type="text"
                        value={filterValue}
                        onChange={(e) => {
                          const val = e.target.value;
                          setFilterValue(val);
                          setCampaign(val);
                          hasPendingChangesRef.current = true;
                          setReportConfig((prev) => ({
                            ...prev,
                            filters: { ...prev.filters, campaign: val, filterValue: val },
                          }));
                        }}
                        placeholder="Escribe el valor..."
                        className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-xs text-slate-800 focus:ring-2 focus:ring-indigo-500 focus:outline-none font-medium pr-12"
                      />
                      <button
                        type="button"
                        onClick={() => setIsManualFilterInput(false)}
                        className="absolute right-1 text-[9px] text-indigo-600 hover:text-indigo-800 bg-indigo-50 px-1 py-0.5 rounded font-bold cursor-pointer"
                        title="Ver lista de opciones"
                      >
                        Lista
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Metric Aggregator Function */}
              <div className="bg-slate-50 p-3.5 rounded-lg border border-slate-200 space-y-2.5">
                <label className="block font-bold text-slate-800 flex items-center justify-between">
                  <span>4. Función Agregación</span>
                  <span className="font-mono text-[10px] bg-indigo-100 text-indigo-800 px-1.5 py-0.5 rounded font-bold">
                    {reportConfig.pivotConfig.aggregator || 'COUNT'}
                  </span>
                </label>
                <select
                  value={reportConfig.pivotConfig.aggregator || 'COUNT'}
                  onChange={(e) => handleUpdatePivotConfig('aggregator', e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-md px-2.5 py-1.5 text-xs text-slate-800 font-bold focus:ring-2 focus:ring-indigo-500 focus:outline-none shadow-2xs"
                >
                  <option value="COUNT">🔢 COUNT (Recuento)</option>
                  <option value="SUM">➕ SUM (Suma numérica)</option>
                  <option value="AVG">📊 AVG (Promedio)</option>
                  <option value="MAX">🔺 MAX (Máximo)</option>
                  <option value="MIN">🔻 MIN (Mínimo)</option>
                </select>
                <p className="text-[10px] text-slate-500 leading-normal">
                  {reportConfig.pivotConfig.aggregator === 'SUM'
                    ? 'Suma los valores del campo evaluado para cada cruce.'
                    : reportConfig.pivotConfig.aggregator === 'AVG'
                    ? 'Promedio aritmético en cada cruce.'
                    : reportConfig.pivotConfig.aggregator === 'MAX'
                    ? 'Valor numérico más alto en el cruce.'
                    : reportConfig.pivotConfig.aggregator === 'MIN'
                    ? 'Valor numérico más bajo en el cruce.'
                    : 'Cuenta el número de contactos clasificados.'}
                </p>
              </div>

              {/* Metric Field & Cell A2 */}
              <div className="bg-slate-50 p-3.5 rounded-lg border border-slate-200 space-y-2.5">
                <label className="block font-bold text-slate-800">
                  5. Campo Evaluar y Celda A2
                </label>
                <select
                  value={reportConfig.pivotConfig.metricField || 'hs_lead_status'}
                  onChange={(e) => handleUpdatePivotConfig('metricField', e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-md px-2.5 py-1.5 text-xs text-slate-800 font-medium focus:ring-2 focus:ring-indigo-500 focus:outline-none shadow-2xs"
                >
                  <optgroup label="Campos Numéricos (Para SUM/AVG/MAX/MIN)">
                    <option value="num_notes">num_notes (Actividades de ventas)</option>
                    <option value="num_contacted_notes">num_contacted_notes (Veces contactado)</option>
                  </optgroup>
                  <optgroup label="Campos de Contacto (Para COUNT)">
                    <option value="hs_lead_status">hs_lead_status (Estado del lead)</option>
                    <option value="hs_object_id">hs_object_id (ID de registro)</option>
                    <option value="lifecyclestage">lifecyclestage (Etapa del ciclo de vida)</option>
                    <option value="fuente">fuente (FUENTE)</option>
                    <option value="campana">campana (Campaña)</option>
                    <option value="carrera_de_interes">carrera_de_interes (Carrera de Interés)</option>
                  </optgroup>
                  <optgroup label="Otras Propiedades Activas">
                    {(reportConfig?.selectedProperties || [])
                      .filter((p) => !['num_notes', 'num_contacted_notes', 'hs_lead_status', 'hs_object_id', 'lifecyclestage', 'fuente', 'campana', 'carrera_de_interes'].includes(p.name))
                      .map((p) => (
                        <option key={p.name} value={p.name}>
                          {p.name} ({p.label})
                        </option>
                      ))}
                  </optgroup>
                </select>
                <div>
                  <label className="block text-[10px] text-slate-500 font-medium mb-1">
                    Título de cabecera (Celda A2 en Hoja 1):
                  </label>
                  <input
                    type="text"
                    value={reportConfig.pivotConfig.metricLabel}
                    onChange={(e) => handleUpdatePivotConfig('metricLabel', e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-xs font-semibold text-indigo-900 shadow-2xs"
                    placeholder="Ej. Cuenta de Estado del lead"
                  />
                </div>
              </div>
            </div>

            {/* Live Visual Preview of Sheet 1 Grid */}
            <div className="p-3 bg-slate-900 text-slate-300 rounded-lg text-xs font-mono">
              <div className="flex items-center justify-between mb-2">
                <span className="text-indigo-400 font-semibold block">
                  Esquema generado para la Hoja 1 del Excel (.xlsx):
                </span>
                <span className="text-[10px] bg-indigo-900/80 text-indigo-200 px-2 py-0.5 rounded font-mono font-bold border border-indigo-700">
                  Agregador: {reportConfig.pivotConfig.aggregator || 'COUNT'}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-1 text-[11px] text-center border border-slate-800 p-2 bg-slate-950 rounded">
                <div className="bg-slate-800 p-1.5 font-bold text-slate-300">
                  A1: {reportConfig.pivotConfig.filterFieldLabel || 'Seleccionar Campaña'}
                </div>
                <div className="col-span-3 bg-slate-800/80 p-1.5 text-indigo-300 font-semibold">
                  B1: {filterValue || '(Varios elementos)'}
                </div>

                <div className="bg-slate-800 p-1.5 font-bold text-slate-300">
                  A2: {reportConfig.pivotConfig.metricLabel} [{reportConfig.pivotConfig.aggregator || 'COUNT'}]
                </div>
                <div className="col-span-3 bg-indigo-950 text-indigo-200 p-1.5 font-bold">
                  B2: Etiquetas de columna ({columnLabelDisplay})
                </div>

                <div className="bg-indigo-950 text-indigo-200 p-1.5 font-bold">
                  A3: Etiquetas de fila ({rowLabelDisplay})
                </div>
                <div className="bg-slate-900 p-1.5">Columna 1</div>
                <div className="bg-slate-900 p-1.5">Columna 2...</div>
                <div className="bg-slate-800 text-white font-bold p-1.5">Total general ({reportConfig.pivotConfig.aggregator || 'COUNT'})</div>

                <div className="bg-slate-900 p-1.5">Fila 1 ({rowLabelDisplay})</div>
                <div className="bg-slate-950 p-1.5 text-slate-400">[{reportConfig.pivotConfig.aggregator || 'COUNT'}]</div>
                <div className="bg-slate-950 p-1.5 text-slate-400">[{reportConfig.pivotConfig.aggregator || 'COUNT'}]</div>
                <div className="bg-slate-900 text-slate-300 font-bold p-1.5">Total</div>
              </div>
            </div>
          </div>

          {/* Section 2: Properties for Sheet 2 ("Contactos") */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-2xs space-y-4">
            <div className="border-b border-slate-100 pb-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <h5 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-indigo-600" />
                  2. Selección y Orden de Columnas para la Hoja 2 ("Contactos")
                </h5>
                <p className="text-xs text-slate-500 mt-0.5">
                  Marca las propiedades que deseas incluir en el reporte y renombra su título en español si lo necesitas.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddCustomModal(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg text-xs font-bold transition-colors cursor-pointer border border-indigo-200"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Añadir Campo Personalizado</span>
                </button>
              </div>
            </div>

            {/* Filter and Search Controls */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 text-xs">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={propertyFilterKeyword}
                  onChange={(e) => setPropertyFilterKeyword(e.target.value)}
                  placeholder="Buscar propiedades por nombre o etiqueta (ej. carrera, telefono, whatsapp)..."
                  className="w-full pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="flex items-center gap-2">
                <div className="flex items-center bg-slate-100 p-0.5 rounded-lg text-xs">
                  <button
                    type="button"
                    onClick={() => setPropertyFilterCategory('all')}
                    className={`px-2.5 py-1 rounded-md font-medium cursor-pointer ${
                      propertyFilterCategory === 'all' ? 'bg-white text-slate-900 shadow-2xs font-bold' : 'text-slate-600'
                    }`}
                  >
                    Todas ({reportConfig.selectedProperties.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setPropertyFilterCategory('selected')}
                    className={`px-2.5 py-1 rounded-md font-medium cursor-pointer ${
                      propertyFilterCategory === 'selected' ? 'bg-white text-indigo-700 shadow-2xs font-bold' : 'text-slate-600'
                    }`}
                  >
                    Activas ({enabledCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setPropertyFilterCategory('standard')}
                    className={`px-2.5 py-1 rounded-md font-medium cursor-pointer ${
                      propertyFilterCategory === 'standard' ? 'bg-white text-slate-900 shadow-2xs font-bold' : 'text-slate-600'
                    }`}
                  >
                    Estándar
                  </button>
                  <button
                    type="button"
                    onClick={() => setPropertyFilterCategory('custom')}
                    className={`px-2.5 py-1 rounded-md font-medium cursor-pointer ${
                      propertyFilterCategory === 'custom' ? 'bg-white text-slate-900 shadow-2xs font-bold' : 'text-slate-600'
                    }`}
                  >
                    Personalizadas
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => handleSelectAllProperties(true)}
                  className="text-[11px] text-indigo-600 hover:underline font-semibold cursor-pointer px-1"
                >
                  Marcar todas
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectAllProperties(false)}
                  className="text-[11px] text-slate-500 hover:underline font-semibold cursor-pointer px-1"
                >
                  Desmarcar
                </button>
              </div>
            </div>

            {/* Properties Table List */}
            <div className="border border-slate-200 rounded-lg overflow-hidden max-h-[460px] overflow-y-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold sticky top-0 z-10">
                  <tr>
                    <th className="py-2.5 px-3 w-12 text-center">Incluir</th>
                    <th className="py-2.5 px-3 w-16 text-center">Orden</th>
                    <th className="py-2.5 px-3">Propiedad Interna (HubSpot)</th>
                    <th className="py-2.5 px-3">Etiqueta en el Excel (.xlsx)</th>
                    <th className="py-2.5 px-3 w-28">Tipo</th>
                    <th className="py-2.5 px-3 w-14 text-center">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {filteredProperties.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-400 text-xs">
                        No se encontraron propiedades que coincidan con la búsqueda.
                      </td>
                    </tr>
                  ) : (
                    filteredProperties.map((prop) => {
                      const selectedIndex = (reportConfig?.selectedProperties || []).findIndex((p) => p.name === prop.name);
                      const isSelectedInArray = selectedIndex !== -1;

                      return (
                        <tr
                          key={prop.name}
                          className={`hover:bg-slate-50/80 transition-colors ${
                            prop.enabled ? 'bg-indigo-50/15' : 'opacity-65'
                          }`}
                        >
                          {/* Checkbox */}
                          <td className="py-2 px-3 text-center">
                            <input
                              type="checkbox"
                              checked={Boolean(prop.enabled)}
                              onChange={() => handleToggleProperty(prop.name)}
                              className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer"
                            />
                          </td>

                          {/* Reorder Buttons */}
                          <td className="py-2 px-3 text-center">
                            {isSelectedInArray ? (
                              <div className="flex items-center justify-center gap-1">
                                <button
                                  type="button"
                                  disabled={selectedIndex === 0}
                                  onClick={() => handleMoveProperty(selectedIndex, 'up')}
                                  className="p-1 text-slate-400 hover:text-indigo-600 disabled:opacity-20 cursor-pointer"
                                  title="Subir columna"
                                >
                                  <ArrowUp className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  disabled={selectedIndex === reportConfig.selectedProperties.length - 1}
                                  onClick={() => handleMoveProperty(selectedIndex, 'down')}
                                  className="p-1 text-slate-400 hover:text-indigo-600 disabled:opacity-20 cursor-pointer"
                                  title="Bajar columna"
                                >
                                  <ArrowDown className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ) : (
                              <span className="text-[10px] text-slate-400">-</span>
                            )}
                          </td>

                          {/* Internal HubSpot Property Name */}
                          <td className="py-2 px-3">
                            <div className="flex items-center gap-2">
                              <code className="font-mono text-xs text-indigo-900 bg-slate-100 px-1.5 py-0.5 rounded font-bold">
                                {prop.name}
                              </code>
                              {prop.isCustom ? (
                                <span className="text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.2 rounded">
                                  Personalizado
                                </span>
                              ) : (
                                <span className="text-[10px] font-semibold bg-slate-100 text-slate-600 px-1.5 py-0.2 rounded">
                                  Estándar
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Column Label in Excel */}
                          <td className="py-2 px-3">
                            <input
                              type="text"
                              value={prop.label}
                              onChange={(e) => handleEditPropertyLabel(prop.name, e.target.value)}
                              placeholder="Nombre de columna en Excel"
                              className="w-full bg-slate-50 border border-slate-200 rounded px-2.5 py-1 text-xs text-slate-800 font-medium focus:bg-white focus:border-indigo-500 focus:outline-none"
                            />
                          </td>

                          {/* Data Type */}
                          <td className="py-2 px-3 text-slate-500 font-mono text-[11px]">
                            {prop.type || 'string'}
                          </td>

                          {/* Actions */}
                          <td className="py-2 px-3 text-center">
                            {prop.isCustom && (
                              <button
                                type="button"
                                onClick={() => handleRemoveProperty(prop.name)}
                                className="text-slate-400 hover:text-rose-600 p-1 transition-colors cursor-pointer"
                                title="Eliminar propiedad de la lista"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="text-[11px] text-slate-500 flex items-center justify-between">
              <span>
                Total de columnas habilitadas para la Hoja 2: <strong className="text-indigo-700">{enabledCount} columnas</strong>.
              </span>
              <span>
                Se exportarán exactamente en el orden mostrado arriba.
              </span>
            </div>
          </div>

          {/* Modal / Dialog to add custom property */}
          {showAddCustomModal && (
            <div className="p-4 bg-indigo-50/80 border border-indigo-200 rounded-xl space-y-3 text-xs">
              <div className="flex items-center justify-between border-b border-indigo-200/60 pb-2">
                <span className="font-bold text-indigo-950 flex items-center gap-1.5">
                  <Plus className="w-4 h-4 text-indigo-600" />
                  Añadir Propiedad Personalizada de tu Portal de HubSpot CRM
                </span>
                <button
                  type="button"
                  onClick={() => setShowAddCustomModal(false)}
                  className="text-slate-500 hover:text-slate-800 text-sm font-bold cursor-pointer"
                >
                  ×
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Nombre Interno de la Propiedad en HubSpot CRM:
                  </label>
                  <input
                    type="text"
                    value={newCustomPropName}
                    onChange={(e) => setNewCustomPropName(e.target.value)}
                    placeholder="ej. carrera_de_interes, sede_matricula"
                    className="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-xs font-mono"
                  />
                  <span className="text-[10px] text-slate-500 mt-0.5 block">
                    El identificador exacto de HubSpot (API internal name)
                  </span>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Encabezado para el Archivo Excel:
                  </label>
                  <input
                    type="text"
                    value={newCustomPropLabel}
                    onChange={(e) => setNewCustomPropLabel(e.target.value)}
                    placeholder="ej. Carrera de Interés"
                    className="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-xs"
                  />
                  <span className="text-[10px] text-slate-500 mt-0.5 block">
                    El título que aparecerá en la fila 1 de la Hoja 2
                  </span>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Tipo de Campo:
                  </label>
                  <select
                    value={newCustomPropType}
                    onChange={(e) => setNewCustomPropType(e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-xs"
                  >
                    <option value="string">Texto / Cadena</option>
                    <option value="number">Número</option>
                    <option value="datetime">Fecha / Hora</option>
                    <option value="date">Solo Fecha</option>
                    <option value="enumeration">Menú desplegable / Selección</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowAddCustomModal(false)}
                  className="px-3 py-1.5 border border-slate-300 bg-white rounded text-slate-700 font-medium cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleAddCustomProperty}
                  disabled={!newCustomPropName.trim()}
                  className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded font-bold disabled:opacity-40 cursor-pointer"
                >
                  Guardar Propiedad
                </button>
              </div>
            </div>
          )}

          {/* Section 3: Filtros de Búsqueda, Segmentación y Propiedades CRM */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-2xs space-y-4">
            <div className="border-b border-slate-100 pb-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-indigo-600" />
                <h5 className="text-sm font-bold text-slate-900 uppercase tracking-wide">
                  3. Filtros Predefinidos de Búsqueda, Segmentación y Propiedades CRM
                </h5>
                <span className="text-[11px] bg-indigo-50 text-indigo-700 border border-indigo-200 px-2 py-0.5 rounded-full font-bold">
                  {activeFiltersCount} Activo{activeFiltersCount !== 1 ? 's' : ''}
                </span>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                  className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 transition-colors cursor-pointer"
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                  {showAdvancedFilters ? 'Ocultar Filtros Secundarios' : 'Mostrar Todos los Filtros'}
                  {showAdvancedFilters ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>
                <button
                  type="button"
                  onClick={handleResetFiltersToAll}
                  className="text-xs font-medium text-slate-500 hover:text-slate-800 flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <RefreshCw className="w-3 h-3" />
                  Restablecer Filtros
                </button>
              </div>
            </div>

            <p className="text-xs text-slate-500">
              Establece los criterios de origen y segmentación que filtrarán los contactos de HubSpot antes de compilarlos en el archivo Excel (.xlsx) y en la tabla dinámica.
            </p>

            {/* Primary Filters Row (5 columns) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 pt-1">
              {/* Asesor Asignado */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5 flex items-center gap-1">
                  <UserCheck className="w-3.5 h-3.5 text-indigo-600" />
                  Asesor Asignado
                </label>
                <select
                  value={reportConfig.filters?.ownerId || 'ALL'}
                  onChange={(e) => handleUpdateFilterCriterion('ownerId', e.target.value)}
                  className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
                >
                  <option value="ALL">Todos los Asesores</option>
                  <option value="__UNASSIGNED__">⚠️ Sin Asesor (Cartera Libre)</option>
                  {(owners || []).map((owner) => (
                    <option key={owner.id} value={owner.id}>
                      {owner.firstName} {owner.lastName} {owner.team ? `(${owner.team})` : ''}
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
                  value={reportConfig.filters?.leadStatus || 'ALL'}
                  onChange={(e) => handleUpdateFilterCriterion('leadStatus', e.target.value)}
                  className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
                >
                  <option value="ALL">Todos los Estados</option>
                  {LEAD_STATUS_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label} ({opt.value})
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
                  value={reportConfig.filters?.lifecycleStage || 'ALL'}
                  onChange={(e) => handleUpdateFilterCriterion('lifecycleStage', e.target.value)}
                  className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
                >
                  <option value="ALL">Todas las Etapas</option>
                  {LIFECYCLE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Período de Creación */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5 flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5 text-indigo-600" />
                  Período de Creación
                </label>
                <select
                  value={dateRange}
                  onChange={(e) => {
                    const val = e.target.value;
                    setDateRange(val);
                    handleUpdateFilterCriterion('dateRange', val);
                  }}
                  className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
                >
                  <option value="last_365d">📅 Último año (365 días) [Por defecto]</option>
                  <option value="ALL">🌟 Todo el histórico disponible</option>
                  <option value="today">☀️ Registrados Hoy</option>
                  <option value="yesterday">⏱️ Ayer</option>
                  <option value="last_7d">🗓️ Últimos 7 días</option>
                  <option value="last_14d">📅 Últimas 2 semanas (14d)</option>
                  <option value="last_30d">🗓️ Últimos 30 días</option>
                  <option value="current_month">📆 Mes actual calendario</option>
                  <option value="custom">📅 Personalizado (Rango)</option>
                </select>
              </div>

              {/* Canal / Fuente */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5 flex items-center gap-1">
                  <Globe className="w-3.5 h-3.5 text-indigo-600" />
                  Canal / Fuente (`fuente`)
                </label>
                <select
                  value={reportConfig.filters?.source || 'ALL'}
                  onChange={(e) => handleUpdateFilterCriterion('source', e.target.value)}
                  className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
                >
                  <option value="ALL">Todos los Canales</option>
                  {(getOptionsForProperty('fuente').length > 0 ? getOptionsForProperty('fuente') : SOURCE_OPTIONS).map(
                    (src) => (
                      <option key={src} value={src}>
                        {src}
                      </option>
                    ),
                  )}
                </select>
              </div>
            </div>

            {/* Inline Custom Date Picker when 'custom' is active */}
            {dateRange === 'custom' && (
              <div className="p-3 bg-indigo-50/70 border border-indigo-200 rounded-lg grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-xs">
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Fecha Inicio (Desde):</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => {
                      const val = e.target.value;
                      setStartDate(val);
                      handleUpdateFilterCriterion('startDate', val);
                    }}
                    className="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-xs text-slate-800 font-medium"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Fecha Fin (Hasta):</label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => {
                      const val = e.target.value;
                      setEndDate(val);
                      handleUpdateFilterCriterion('endDate', val);
                    }}
                    className="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-xs text-slate-800 font-medium"
                  />
                </div>
                <div className="flex items-end">
                  <div className="w-full p-2 bg-white/80 border border-indigo-100 rounded text-[11px] text-slate-600">
                    Rango activo:{' '}
                    <strong className="text-indigo-900 font-semibold">{startDate || '...'}</strong> al{' '}
                    <strong className="text-indigo-900 font-semibold">{endDate || '...'}</strong>
                  </div>
                </div>
              </div>
            )}

            {/* Secondary / Advanced Filters Row */}
            {showAdvancedFilters && (
              <div className="pt-3 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 animate-in fade-in duration-150">
                {/* Campaña UTM / CRM */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Campaña (`utm_campaign`)
                  </label>
                  <select
                    value={reportConfig.filters?.campaign || 'ALL'}
                    onChange={(e) => {
                      const val = e.target.value;
                      handleUpdateFilterCriterion('campaign', val);
                      handleUpdateFilterCriterion('filterValue', val);
                      setFilterValue(val);
                      setCampaign(val);
                    }}
                    className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
                  >
                    <option value="ALL">Todas las Campañas</option>
                    {getOptionsForProperty('campana').map((camp) => (
                      <option key={camp} value={camp}>
                        {camp}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Inactividad & SLA */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5 flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-amber-600" />
                    Inactividad &amp; SLA
                  </label>
                  <select
                    value={reportConfig.filters?.inactivityRange || 'ALL'}
                    onChange={(e) => handleUpdateFilterCriterion('inactivityRange', e.target.value)}
                    className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
                  >
                    <option value="ALL">Cualquier Inactividad</option>
                    <option value="overdue_24h">🚨 SLA Vencido (&gt; 24h sin contacto)</option>
                    <option value="overdue_48h">⚠️ Riesgo Alto (&gt; 48h sin contacto)</option>
                    <option value="overdue_7d">⛔ Desatendidos (&gt; 7 días)</option>
                    <option value="recent_12h">⚡ Actividad Reciente (&lt; 12h)</option>
                  </select>
                </div>

                {/* Ciudad / Región */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5 flex items-center gap-1">
                    <Building2 className="w-3.5 h-3.5 text-slate-500" />
                    Ciudad / Región (`city`)
                  </label>
                  <select
                    value={
                      (reportConfig.filters?.customFilters || []).find((f) => f.propertyName === 'city')?.value || 'ALL'
                    }
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === 'ALL') {
                        const existing = (reportConfig.filters?.customFilters || []).filter(
                          (f) => f.propertyName !== 'city',
                        );
                        handleUpdateFilterCriterion('customFilters', existing);
                      } else {
                        const existing = (reportConfig.filters?.customFilters || []).filter(
                          (f) => f.propertyName !== 'city',
                        );
                        handleUpdateFilterCriterion('customFilters', [
                          ...existing,
                          {
                            id: `city_${Date.now()}`,
                            propertyName: 'city',
                            operator: 'EQ',
                            value: val,
                          },
                        ]);
                      }
                    }}
                    className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
                  >
                    <option value="ALL">Todas las Ciudades</option>
                    {getOptionsForProperty('city').map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Industria / Sector */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5 flex items-center gap-1">
                    <Building2 className="w-3.5 h-3.5 text-slate-500" />
                    Industria / Sector
                  </label>
                  <select
                    value={reportConfig.filters?.industry || 'ALL'}
                    onChange={(e) => handleUpdateFilterCriterion('industry', e.target.value)}
                    className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
                  >
                    <option value="ALL">Todas las Industrias</option>
                    {INDUSTRY_OPTIONS.map((ind) => (
                      <option key={ind} value={ind}>
                        {ind}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {/* Custom Property Rules Subsection */}
            <div className="pt-4 border-t border-slate-100 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h6 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <span>Reglas Adicionales por Propiedades Personalizadas y Campos Específicos</span>
                    <span className="bg-indigo-100 text-indigo-700 px-1.5 py-0.2 rounded-full font-mono text-[10px] font-bold">
                      {(reportConfig.filters?.customFilters || []).length}
                    </span>
                  </h6>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Añade condiciones flexibles por cualquier propiedad personalizada (carrera, whatsapp, estado, etc.) mostrando valores detectados en el CRM o texto libre.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleAddCustomFilter}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg text-xs font-bold transition-colors cursor-pointer border border-indigo-200 shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Añadir Regla de Filtro</span>
                </button>
              </div>

              {/* List of rules */}
              {(reportConfig.filters?.customFilters || []).length === 0 ? (
                <div className="p-4 bg-slate-50 border border-dashed border-slate-200 rounded-lg text-center text-xs text-slate-500">
                  <p className="mb-2">No hay reglas de filtros personalizadas adicionales.</p>
                  <button
                    type="button"
                    onClick={handleAddCustomFilter}
                    className="inline-flex items-center gap-1 px-3 py-1 bg-white border border-indigo-200 text-indigo-700 hover:bg-indigo-50 rounded-md text-xs font-semibold cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Crear regla de filtro por propiedad</span>
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {(reportConfig.filters?.customFilters || []).map((rule, idx) => {
                    const isValueDisabled = rule.operator === 'HAS_PROPERTY' || rule.operator === 'NOT_HAS_PROPERTY';
                    const propOptions = getOptionsForProperty(rule.propertyName);
                    const isFreeTextMode = freeTextFilterRuleIds.has(rule.id || '');

                    return (
                      <div
                        key={rule.id || `tab2_filter_${idx}`}
                        className="p-3 bg-slate-50 border border-slate-200 rounded-lg grid grid-cols-1 md:grid-cols-12 gap-3 items-center text-xs"
                      >
                        {/* Property selection */}
                        <div className="md:col-span-4">
                          <label className="block text-[10px] text-slate-500 font-semibold mb-1">
                            Propiedad de Contacto
                          </label>
                          <select
                            value={rule.propertyName}
                            onChange={(e) => {
                              const newProp = e.target.value;
                              handleUpdateCustomFilter(rule.id || '', 'propertyName', newProp);
                              // Auto-suggest first option if available and not free text
                              const newOpts = getOptionsForProperty(newProp);
                              if (newOpts.length > 0 && !freeTextFilterRuleIds.has(rule.id || '')) {
                                handleUpdateCustomFilter(rule.id || '', 'value', newOpts[0]);
                              }
                            }}
                            className="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-xs text-slate-800 font-medium focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                          >
                            <optgroup label="Propiedades Personalizadas Más Usadas">
                              <option value="carrera_de_interes">carrera_de_interes (Carrera de Interés)</option>
                              <option value="fuente">fuente (FUENTE / Canal)</option>
                              <option value="campana">campana (Campaña)</option>
                              <option value="whatsapp_phone_number">whatsapp_phone_number (WhatsApp)</option>
                              <option value="estado">estado (Estado)</option>
                              <option value="mensaje">mensaje (Mensaje)</option>
                              <option value="fecha_de_matricula">fecha_de_matricula (Fecha Matrícula)</option>
                            </optgroup>
                            <optgroup label="Propiedades Estándar">
                              <option value="hs_lead_status">hs_lead_status (Estado del lead)</option>
                              <option value="lifecyclestage">lifecyclestage (Etapa del ciclo de vida)</option>
                              <option value="phone">phone (Teléfono)</option>
                              <option value="firstname">firstname (Nombre)</option>
                              <option value="lastname">lastname (Apellidos)</option>
                              <option value="city">city (Ciudad)</option>
                              <option value="industry">industry (Industria)</option>
                              <option value="num_notes">num_notes (Actividades de ventas)</option>
                              <option value="num_contacted_notes">num_contacted_notes (Veces contactado)</option>
                            </optgroup>
                            <optgroup label="Todas las Propiedades del Portal CRM">
                              {(availableHubSpotProps || [])
                                .filter(
                                  (ap) =>
                                    ![
                                      'carrera_de_interes',
                                      'fuente',
                                      'campana',
                                      'whatsapp_phone_number',
                                      'estado',
                                      'mensaje',
                                      'fecha_de_matricula',
                                      'hs_lead_status',
                                      'lifecyclestage',
                                      'phone',
                                      'firstname',
                                      'lastname',
                                      'city',
                                      'industry',
                                      'num_notes',
                                      'num_contacted_notes',
                                    ].includes(ap.name),
                                )
                                .map((ap) => (
                                  <option key={ap.name} value={ap.name}>
                                    {ap.name} ({ap.label})
                                  </option>
                                ))}
                            </optgroup>
                          </select>
                        </div>

                        {/* Operator selection */}
                        <div className="md:col-span-3">
                          <label className="block text-[10px] text-slate-500 font-semibold mb-1">
                            Condición / Operador
                          </label>
                          <select
                            value={rule.operator}
                            onChange={(e) => handleUpdateCustomFilter(rule.id || '', 'operator', e.target.value)}
                            className="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-xs text-slate-800 font-medium focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                          >
                            <option value="EQ">Igual a (=)</option>
                            <option value="NEQ">Diferente de (≠)</option>
                            <option value="CONTAINS_TOKEN">Contiene texto</option>
                            <option value="NOT_CONTAINS">No contiene</option>
                            <option value="GTE">Mayor o igual (&gt;=)</option>
                            <option value="LTE">Menor o igual (&lt;=)</option>
                            <option value="HAS_PROPERTY">Tiene valor (no vacío)</option>
                            <option value="NOT_HAS_PROPERTY">Está vacío</option>
                          </select>
                        </div>

                        {/* Flexible Value Selector */}
                        <div className="md:col-span-4">
                          <div className="flex items-center justify-between mb-1">
                            <label className="block text-[10px] text-slate-500 font-semibold">
                              Valor Requerido
                            </label>
                            {propOptions.length > 0 && !isValueDisabled && (
                              <button
                                type="button"
                                onClick={() => toggleRuleInputMode(rule.id || '')}
                                className="text-[10px] text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-0.5 cursor-pointer"
                                title={
                                  isFreeTextMode
                                    ? 'Ver valores sugeridos del CRM'
                                    : 'Escribir valor manual libre'
                                }
                              >
                                {isFreeTextMode ? (
                                  <>
                                    <Sliders className="w-3 h-3" />
                                    <span>Elegir lista</span>
                                  </>
                                ) : (
                                  <>
                                    <Pencil className="w-3 h-3" />
                                    <span>Texto libre</span>
                                  </>
                                )}
                              </button>
                            )}
                          </div>

                          {isValueDisabled ? (
                            <input
                              type="text"
                              disabled
                              value="(No requiere valor)"
                              className="w-full bg-slate-100 border border-slate-200 rounded px-2.5 py-1.5 text-xs text-slate-400 cursor-not-allowed"
                            />
                          ) : propOptions.length > 0 && !isFreeTextMode ? (
                            <div className="relative flex items-center">
                              <select
                                value={rule.value || ''}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  if (val === '__CUSTOM_TEXT__') {
                                    toggleRuleInputMode(rule.id || '');
                                  } else {
                                    handleUpdateCustomFilter(rule.id || '', 'value', val);
                                  }
                                }}
                                className="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-xs text-slate-800 font-medium focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                              >
                                <option value="">-- Seleccionar valor ({propOptions.length} disponibles) --</option>
                                {propOptions.map((opt) => (
                                  <option key={opt} value={opt}>
                                    {opt}
                                  </option>
                                ))}
                                <option value="__CUSTOM_TEXT__">✏️ Escribir otro valor personalizado...</option>
                              </select>
                            </div>
                          ) : (
                            <div className="relative flex items-center">
                              <input
                                type="text"
                                placeholder={
                                  propOptions.length > 0
                                    ? `Ej. ${propOptions.slice(0, 2).join(', ')}...`
                                    : 'Ej. Medicina, Bogotá, etc.'
                                }
                                value={rule.value || ''}
                                onChange={(e) => handleUpdateCustomFilter(rule.id || '', 'value', e.target.value)}
                                className="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-xs text-slate-800 focus:ring-2 focus:ring-indigo-500 focus:outline-none font-medium"
                              />
                            </div>
                          )}
                        </div>

                        {/* Remove rule button */}
                        <div className="md:col-span-1 flex items-end justify-center pt-2 md:pt-4">
                          <button
                            type="button"
                            onClick={() => handleRemoveCustomFilter(rule.id || '')}
                            className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded transition-colors cursor-pointer"
                            title="Eliminar regla de filtro"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Action bottom button */}
          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={() => setActiveTab('generator')}
              className="text-xs text-indigo-600 hover:underline font-bold flex items-center gap-1 cursor-pointer"
            >
              Ir al Generador de Reportes →
            </button>

            <button
              type="button"
              onClick={handleManualSaveConfig}
              disabled={isSavingConfig}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold shadow-sm transition-all cursor-pointer disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              <span>Guardar Configuración de Reportes</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
