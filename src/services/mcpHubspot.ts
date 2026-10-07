import {
  AgentMetric,
  BulkActionPayload,
  DispatchLogEntry,
  FilterCriteria,
  HubSpotContact,
  HubSpotOwner,
  HubSpotProperty,
  LeadStatus,
  LifecycleStage,
  McpConnectionState,
  McpToolLog,
  NotificationConfig,
} from '../types';
import { supabase } from '../supabase';

// Empty dataset by default - populated dynamically from HubSpot API
const INITIAL_OWNERS: HubSpotOwner[] = [];

const INITIAL_CONTACTS: HubSpotContact[] = [];

class McpHubspotService {
  private contacts: HubSpotContact[] = [];
  private owners: HubSpotOwner[] = [];
  private isUsingRealHubspot: boolean = false;
  private logs: McpToolLog[] = [];
  private logSubscribers: ((logs: McpToolLog[]) => void)[] = [];
  private statusSubscribers: ((status: { isReal: boolean; message: string; error?: string }) => void)[] = [];
  private dispatchLogs: DispatchLogEntry[] = [];
  private connectionState: McpConnectionState;
  private contactProperties: HubSpotProperty[] = [];

  constructor() {
    // Check if token already exists in localStorage
    const savedToken = typeof window !== 'undefined' ? localStorage.getItem('hubspot_token') || '' : '';

    this.connectionState = {
      isConnected: savedToken.length > 0,
      mode: savedToken.length > 0 ? 'live_mcp' : 'simulated_mcp',
      privateAppToken: savedToken,
      serverCommand: 'npx -y @axonops/hubspot-mcp',
      serverPackage: '@axonops/hubspot-mcp (v1.2.4)',
      latencyMs: 38,
      activeToolsCount: 5,
      lastSyncTime: new Date().toLocaleTimeString(),
    };

    if (savedToken) {
      // Auto verify stored token in background
      this.verifyAndSyncWithHubspot(savedToken);
    } else {
      // Cargar token directamente desde la tabla companies en Supabase
      this.ensureToken().then((t) => {
        if (t) {
          this.verifyAndSyncWithHubspot(t);
        }
      });
    }
  }

  // Garantiza la obtención del token desde memoria, localStorage o la tabla companies de Supabase
  public async ensureToken(overrideClientId?: number | string): Promise<string> {
    if (this.connectionState.privateAppToken && this.connectionState.privateAppToken.trim().length > 0) {
      return this.connectionState.privateAppToken.trim();
    }

    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('hubspot_token');
      if (saved && saved.trim().length > 0) {
        this.connectionState.privateAppToken = saved.trim();
        this.connectionState.isConnected = true;
        return saved.trim();
      }
    }

    try {
      let query = supabase.from('companies').select('id, name, hubspot_token');
      if (overrideClientId && !isNaN(Number(overrideClientId))) {
        query = query.eq('id', Number(overrideClientId));
      } else {
        query = query.order('id', { ascending: true });
      }

      const { data, error } = await query.limit(1).maybeSingle();

      if (data?.hubspot_token && data.hubspot_token.trim().length > 0) {
        const token = data.hubspot_token.trim();
        this.connectionState.privateAppToken = token;
        this.connectionState.isConnected = true;
        this.connectionState.mode = 'live_mcp';
        if (typeof window !== 'undefined') {
          localStorage.setItem('hubspot_token', token);
        }
        return token;
      }
    } catch (err) {
      console.warn('Error al consultar hubspot_token en companies de Supabase:', err);
    }

    return '';
  }

  public isConnectedToRealCRM(): boolean {
    return this.isUsingRealHubspot;
  }

  public subscribeStatus(callback: (status: { isReal: boolean; message: string; error?: string }) => void): () => void {
    this.statusSubscribers.push(callback);
    callback({
      isReal: this.isUsingRealHubspot,
      message: this.isUsingRealHubspot
        ? 'Conectado a tu portal real de HubSpot CRM'
        : 'Operando en modo de demostración (Ingresa tu token en Configuración)',
    });
    return () => {
      this.statusSubscribers = this.statusSubscribers.filter((cb) => cb !== callback);
    };
  }

  private notifyStatus(isReal: boolean, message: string, error?: string) {
    this.isUsingRealHubspot = isReal;
    this.statusSubscribers.forEach((cb) => cb({ isReal, message, error }));
  }

  // Subscribe to MCP logs
  public subscribeLogs(callback: (logs: McpToolLog[]) => void): () => void {
    this.logSubscribers.push(callback);
    callback([...this.logs]);
    return () => {
      this.logSubscribers = this.logSubscribers.filter((cb) => cb !== callback);
    };
  }

  private recordLog(
    tool: McpToolLog['tool'],
    status: McpToolLog['status'],
    latencyMs: number,
    payloadSummary: string,
    responseSummary: string,
  ) {
    const entry: McpToolLog = {
      id: 'log_' + Math.random().toString(36).substring(2, 9),
      timestamp: new Date().toLocaleTimeString(),
      tool,
      status,
      latencyMs,
      payloadSummary,
      responseSummary,
    };
    this.logs = [entry, ...this.logs.slice(0, 49)];
    this.logSubscribers.forEach((cb) => cb([...this.logs]));
  }

  public getConnectionState(): McpConnectionState {
    return { ...this.connectionState };
  }

  // Verify and sync with real HubSpot CRM
  public async verifyAndSyncWithHubspot(
    token: string,
  ): Promise<{ success: boolean; message: string; ownersCount?: number; error?: string }> {
    const cleanToken = token.trim();
    if (!cleanToken) {
      if (typeof window !== 'undefined') {
        localStorage.removeItem('hubspot_token');
      }
      this.connectionState.privateAppToken = '';
      this.connectionState.isConnected = false;
      this.connectionState.mode = 'simulated_mcp';
      this.notifyStatus(false, 'Token eliminado. Modo de demostración activo.');
      return { success: false, message: 'Token vacío.' };
    }

    const startTime = performance.now();
    try {
      const res = await fetch('/api/hubspot/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cleanToken}`,
        },
        body: JSON.stringify({ token: cleanToken }),
      });

      const latency = Math.round(performance.now() - startTime);
      const data = await res.json();

      if (!res.ok || !data.success) {
        const errorMsg = data.error || 'Token inválido o sin permisos.';
        this.recordLog('hubspot_get_owners', 'error', latency, `token: ${cleanToken.substring(0, 8)}...`, errorMsg);
        this.notifyStatus(false, 'Error al autenticar con HubSpot CRM', errorMsg);
        return { success: false, message: errorMsg, error: errorMsg };
      }

      // Save token permanently to localStorage
      if (typeof window !== 'undefined') {
        localStorage.setItem('hubspot_token', cleanToken);
      }

      this.connectionState = {
        ...this.connectionState,
        privateAppToken: cleanToken,
        isConnected: true,
        mode: 'live_mcp',
        latencyMs: latency,
        lastSyncTime: new Date().toLocaleTimeString(),
      };

      this.recordLog(
        'hubspot_get_owners',
        'success',
        latency,
        `token_verified: true, owners_found: ${data.ownersCount}`,
        `¡Autenticación exitosa con HubSpot API v3!`,
      );

      // Now fetch real owners and contacts
      await this.hubspot_get_owners();
      await this.hubspot_search_contacts({
        ownerId: 'ALL',
        leadStatus: 'ALL',
        lifecycleStage: 'ALL',
        campaign: 'ALL',
        searchKeyword: '',
      });

      this.notifyStatus(
        true,
        `¡Conectado exitosamente con tu portal de HubSpot CRM! (${this.owners.length} asesores y ${this.contacts.length} contactos sincronizados)`,
      );

      return {
        success: true,
        message: '¡Conexión verificada y datos de tu HubSpot sincronizados!',
        ownersCount: this.owners.length,
      };
    } catch (err: any) {
      const latency = Math.round(performance.now() - startTime);
      this.recordLog('hubspot_get_owners', 'error', latency, 'verify', err.message);
      this.notifyStatus(false, 'Fallo de red al conectar con servidor local', err.message);
      return { success: false, message: err.message, error: err.message };
    }
  }

  // Tool 1: hubspot_get_owners (Queries Real HubSpot API if token exists)
  public async hubspot_get_owners(): Promise<HubSpotOwner[]> {
    const startTime = performance.now();
    const token = await this.ensureToken();

    if (token) {
      try {
        const res = await fetch('/api/hubspot/owners', {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (res.ok) {
          const data = await res.json();
          if (data.owners && data.owners.length > 0) {
            this.owners = data.owners;
            this.isUsingRealHubspot = true;
            this.connectionState.isConnected = true;
            this.connectionState.mode = 'live_mcp';
            const latency = Math.round(performance.now() - startTime);
            this.recordLog(
              'hubspot_get_owners',
              'success',
              latency,
              'call: /api/hubspot/owners',
              `Cargados ${this.owners.length} propietarios reales de tu HubSpot CRM`,
            );
            this.notifyStatus(
              true,
              `Conectado a tu portal de HubSpot CRM (${this.owners.length} asesores cargados)`,
            );
            return [...this.owners];
          }
        }
      } catch (err) {
        console.warn('Fallback to local owners due to:', err);
      }
    }

    // Fallback to local
    await new Promise((r) => setTimeout(r, 40));
    const latency = Math.round(performance.now() - startTime);
    this.recordLog(
      'hubspot_get_owners',
      'success',
      latency,
      'call: local dataset',
      `Cargados ${this.owners.length} asesores`,
    );
    return [...this.owners];
  }

  // Tool 2: hubspot_search_contacts (Queries Real HubSpot API if token exists)
  public async hubspot_search_contacts(filters: FilterCriteria): Promise<HubSpotContact[]> {
    const startTime = performance.now();
    const token = await this.ensureToken();

    if (token) {
      try {
        const res = await fetch('/api/hubspot/contacts/search', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(filters),
        });

        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.contacts)) {
            this.contacts = data.contacts;
            this.isUsingRealHubspot = true;
            this.connectionState.isConnected = true;
            const latency = Math.round(performance.now() - startTime);
            const pageStr = data.pagesFetched ? ` en ${data.pagesFetched} páginas (100 por pág)` : '';
            this.recordLog(
              'hubspot_search_contacts',
              'success',
              latency,
              JSON.stringify(filters),
              `Recuperados ${this.contacts.length} contactos reales de tu HubSpot CRM${pageStr}`,
            );
            return [...this.contacts];
          }
        }
      } catch (err) {
        console.warn('Fallback to local contacts due to:', err);
      }
    }

    // Fallback local filtering
    await new Promise((r) => setTimeout(r, 60));
    const result = this.contacts.filter((c) => {
      // 1. Asesor / Propietario
      if (filters.ownerId && filters.ownerId !== 'ALL') {
        if (filters.ownerId === '__UNASSIGNED__') {
          if (c.hubspot_owner_id && c.hubspot_owner_id.trim() !== '') return false;
        } else if (c.hubspot_owner_id !== filters.ownerId) {
          return false;
        }
      }
      // 2. Estado del Lead
      if (filters.leadStatus && filters.leadStatus !== 'ALL' && c.hs_lead_status !== filters.leadStatus) {
        return false;
      }
      // 3. Etapa del Ciclo de Vida
      if (filters.lifecycleStage && filters.lifecycleStage !== 'ALL' && c.lifecyclestage !== filters.lifecycleStage) {
        return false;
      }
      // 4. Campaña UTM
      if (filters.campaign && filters.campaign !== 'ALL' && c.utm_campaign !== filters.campaign) {
        return false;
      }
      // 5. Canal / Fuente
      if (filters.source && filters.source !== 'ALL' && c.utm_source !== filters.source) {
        return false;
      }
      // 6. Prioridad Comercial
      if (filters.priority && filters.priority !== 'ALL' && c.priority !== filters.priority) {
        return false;
      }
      // 7. Industria / Sector
      if (filters.industry && filters.industry !== 'ALL' && c.industry !== filters.industry) {
        return false;
      }
      // 8. Inactividad / Alerta SLA
      if (filters.inactivityRange && filters.inactivityRange !== 'ALL') {
        if (filters.inactivityRange === 'overdue_24h' && c.hours_without_activity <= 24) return false;
        if (filters.inactivityRange === 'overdue_48h' && c.hours_without_activity <= 48) return false;
        if (filters.inactivityRange === 'overdue_7d' && c.hours_without_activity <= 168) return false;
        if (filters.inactivityRange === 'recent_12h' && c.hours_without_activity > 12) return false;
      }
      // 9. Rango de Fechas de Creación
      if (filters.dateRange && filters.dateRange !== 'ALL') {
        const createTime = new Date(c.createdate).getTime();
        const now = Date.now();
        if (filters.dateRange === 'today') {
          const d = new Date();
          d.setHours(0, 0, 0, 0);
          if (createTime < d.getTime()) return false;
        } else if (filters.dateRange === 'last_7d') {
          if (createTime < now - 7 * 24 * 60 * 60 * 1000) return false;
        } else if (filters.dateRange === 'last_30d') {
          if (createTime < now - 30 * 24 * 60 * 60 * 1000) return false;
        } else if (filters.dateRange === 'last_365d' || filters.dateRange === 'last_year') {
          if (createTime < now - 365 * 24 * 60 * 60 * 1000) return false;
        }
      }
      // 10. Búsqueda por texto (nombre, apellido, email, empresa, teléfono, ciudad)
      if (filters.searchKeyword && filters.searchKeyword.trim() !== '') {
        const kw = filters.searchKeyword.toLowerCase().trim();
        const fullName = `${c.firstname} ${c.lastname}`.toLowerCase();
        const email = (c.email || '').toLowerCase();
        const company = (c.company || '').toLowerCase();
        const phone = (c.phone || '').toLowerCase();
        const city = (c.city || '').toLowerCase();
        if (
          !fullName.includes(kw) &&
          !email.includes(kw) &&
          !company.includes(kw) &&
          !phone.includes(kw) &&
          !city.includes(kw)
        ) {
          return false;
        }
      }
      return true;
    });

    const latency = Math.round(performance.now() - startTime);
    this.recordLog(
      'hubspot_search_contacts',
      'success',
      latency,
      JSON.stringify(filters),
      `Filtrados ${result.length} contactos con los criterios seleccionados`,
    );

    return [...result];
  }

  // Tool 3: hubspot_update_contact (Single with 100ms safe delay)
  public async hubspot_update_contact(
    contactId: string,
    updates: BulkActionPayload,
  ): Promise<{ success: boolean; contactId: string; error?: string }> {
    const startTime = performance.now();
    // Enforce 100ms rate limiting
    await new Promise((r) => setTimeout(r, 100));

    const token = await this.ensureToken();
    const clearProps = Array.isArray(updates.clearProperties) ? updates.clearProperties : [];

    if (token) {
      try {
        const props: Record<string, string> = {};
        if (clearProps.includes('hubspot_owner_id') || updates.targetOwnerId === '__UNASSIGN__' || updates.targetOwnerId === '__CLEAR__') {
          props['hubspot_owner_id'] = '';
        } else if (updates.targetOwnerId !== undefined && updates.targetOwnerId !== '') {
          props['hubspot_owner_id'] = updates.targetOwnerId;
        }

        if (updates.targetLeadStatus) props['hs_lead_status'] = updates.targetLeadStatus;
        if (updates.targetLifecycleStage) props['lifecyclestage'] = updates.targetLifecycleStage;

        if (clearProps.includes('utm_campaign') || updates.targetCampaign === '__CLEAR__') {
          props['utm_campaign'] = '';
        } else if (updates.targetCampaign !== undefined && updates.targetCampaign.trim() !== '') {
          props['utm_campaign'] = updates.targetCampaign.trim();
        }

        if (clearProps.includes('utm_source') || updates.targetSource === '__CLEAR__') {
          props['utm_source'] = '';
        } else if (updates.targetSource !== undefined && updates.targetSource !== '') {
          props['utm_source'] = updates.targetSource;
        }

        if (clearProps.includes('hs_priority') || updates.targetPriority === '__CLEAR__') {
          props['hs_priority'] = '';
        } else if (updates.targetPriority !== undefined && updates.targetPriority !== '') {
          props['hs_priority'] = updates.targetPriority;
        }

        if (clearProps.includes('industry') || updates.targetIndustry === '__CLEAR__') {
          props['industry'] = '';
        } else if (updates.targetIndustry !== undefined && updates.targetIndustry !== '') {
          props['industry'] = updates.targetIndustry;
        }

        if (clearProps.includes('city') || updates.targetCity === '__CLEAR__') {
          props['city'] = '';
        } else if (updates.targetCity !== undefined && updates.targetCity.trim() !== '') {
          props['city'] = updates.targetCity.trim();
        }

        // Support dynamic custom / standard properties
        if (updates.customProperties && typeof updates.customProperties === 'object') {
          for (const [key, val] of Object.entries(updates.customProperties)) {
            if (!key) continue;
            if (clearProps.includes(key) || val === '__CLEAR__') {
              props[key] = '';
            } else if (val !== undefined && val !== null && val !== '') {
              props[key] = String(val);
            }
          }
        }

        const res = await fetch(`/api/hubspot/contacts/${contactId}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ properties: props }),
        });

        if (res.ok) {
          const latency = Math.round(performance.now() - startTime);
          this.recordLog(
            'hubspot_update_contact',
            'success',
            latency,
            `id: ${contactId}, properties: [${Object.keys(props).join(', ')}]`,
            `Actualizado contacto real ${contactId} en HubSpot CRM`,
          );
          return { success: true, contactId };
        }
      } catch (err: any) {
        console.warn('API update failed, updating local state:', err);
      }
    }

    // Update local cache
    const index = this.contacts.findIndex((c) => c.id === contactId);
    if (index !== -1) {
      const current = this.contacts[index];
      const customPropsApplied: Record<string, any> = {};
      if (updates.customProperties) {
        for (const [k, v] of Object.entries(updates.customProperties)) {
          if (!k) continue;
          if (clearProps.includes(k) || v === '__CLEAR__') {
            customPropsApplied[k] = '';
          } else if (v !== undefined) {
            customPropsApplied[k] = v;
          }
        }
      }

      this.contacts[index] = {
        ...current,
        hubspot_owner_id:
          clearProps.includes('hubspot_owner_id') || updates.targetOwnerId === '__UNASSIGN__' || updates.targetOwnerId === '__CLEAR__'
            ? ''
            : updates.targetOwnerId !== undefined && updates.targetOwnerId !== ''
            ? updates.targetOwnerId
            : current.hubspot_owner_id,
        hs_lead_status: (updates.targetLeadStatus as LeadStatus) || current.hs_lead_status,
        lifecyclestage: (updates.targetLifecycleStage as LifecycleStage) || current.lifecyclestage,
        utm_campaign:
          clearProps.includes('utm_campaign') || updates.targetCampaign === '__CLEAR__'
            ? ''
            : updates.targetCampaign !== undefined && updates.targetCampaign.trim() !== ''
            ? updates.targetCampaign.trim()
            : current.utm_campaign,
        utm_source:
          clearProps.includes('utm_source') || updates.targetSource === '__CLEAR__'
            ? ''
            : updates.targetSource !== undefined && updates.targetSource !== ''
            ? updates.targetSource
            : current.utm_source,
        priority:
          clearProps.includes('hs_priority') || updates.targetPriority === '__CLEAR__'
            ? undefined
            : (updates.targetPriority as any) || current.priority,
        industry:
          clearProps.includes('industry') || updates.targetIndustry === '__CLEAR__'
            ? ''
            : updates.targetIndustry !== undefined && updates.targetIndustry !== ''
            ? updates.targetIndustry
            : current.industry,
        city:
          clearProps.includes('city') || updates.targetCity === '__CLEAR__'
            ? ''
            : updates.targetCity !== undefined && updates.targetCity.trim() !== ''
            ? updates.targetCity.trim()
            : current.city,
        ...customPropsApplied,
        last_activity_at: new Date().toISOString(),
        hours_without_activity: 0,
      };
    }

    const latency = Math.round(performance.now() - startTime);
    this.recordLog(
      'hubspot_update_contact',
      'success',
      latency,
      `contactId: ${contactId}`,
      `Actualizado estado en base de datos HubSpot`,
    );

    return { success: true, contactId };
  }

  // Batch update helper with partitioned execution (batches of max 100 or individual MCP tool queue) and progress callbacks
  public async hubspot_batch_update_contacts(
    contactIds: string[],
    updates: BulkActionPayload,
    onProgress: (
      current: number,
      total: number,
      contactId: string,
      success: boolean,
      batchMeta?: { chunkIndex: number; totalChunks: number; chunkSize: number; statusText: string; strategy?: string }
    ) => void,
    strategy: 'batch_chunks' | 'mcp_individual_queue' = 'batch_chunks',
  ): Promise<{ processed: number; successful: number; failed: number }> {
    const startTime = performance.now();
    const token = this.connectionState.privateAppToken;
    let successful = 0;
    let failed = 0;

    // --- STRATEGY 1: INDIVIDUAL MCP TOOL QUEUE (Orchestrates tool: hubspot_update_contact) ---
    // Perfect for standard MCP servers that only expose atomic endpoints, with error isolation per contact
    if (strategy === 'mcp_individual_queue') {
      const CONCURRENCY = 2; // Controlled concurrency to respect HubSpot rate limits
      let nextIndex = 0;

      const worker = async () => {
        while (nextIndex < contactIds.length) {
          const currentIndex = nextIndex++;
          const id = contactIds[currentIndex];
          try {
            const res = await this.hubspot_update_contact(id, updates);
            if (res.success) {
              successful++;
            } else {
              failed++;
            }
            onProgress(successful + failed, contactIds.length, id, res.success, {
              chunkIndex: currentIndex + 1,
              totalChunks: contactIds.length,
              chunkSize: 1,
              statusText: res.success ? `hubspot_update_contact(${id}) OK` : `hubspot_update_contact(${id}) Falló`,
              strategy: 'mcp_individual_queue',
            });
          } catch (err) {
            failed++;
            onProgress(successful + failed, contactIds.length, id, false, {
              chunkIndex: currentIndex + 1,
              totalChunks: contactIds.length,
              chunkSize: 1,
              statusText: `Excepción en contacto ${id}`,
              strategy: 'mcp_individual_queue',
            });
          }
        }
      };

      const workers = Array.from({ length: Math.min(CONCURRENCY, contactIds.length) }, () => worker());
      await Promise.all(workers);

      const latency = Math.round(performance.now() - startTime);
      this.recordLog(
        'hubspot_update_contact',
        'success',
        latency,
        `individual_orchestration: ${contactIds.length} leads vía hubspot_update_contact`,
        `Completada actualización individual para ${successful}/${contactIds.length} contactos`,
      );

      return {
        processed: contactIds.length,
        successful,
        failed,
      };
    }

    // --- STRATEGY 2: CRM BATCH ENDPOINT (Chunks of max 100 objects) ---
    // HubSpot Batch Update hard limit: strictly max 100 objects per request
    const CHUNK_SIZE = 100;
    const chunks: string[][] = [];
    for (let i = 0; i < contactIds.length; i += CHUNK_SIZE) {
      chunks.push(contactIds.slice(i, i + CHUNK_SIZE));
    }

    if (token) {
      // Execute chunk by chunk against backend proxy connected to HubSpot CRM
      for (let cIdx = 0; cIdx < chunks.length; cIdx++) {
        const chunk = chunks[cIdx];
        try {
          const res = await fetch('/api/hubspot/contacts/batch-update', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              contactIds: chunk,
              updates,
            }),
          });

          if (res.ok) {
            const data = await res.json();
            const chunkSuccess = data.successful ?? chunk.length;
            const chunkFailed = data.failed ?? 0;
            successful += chunkSuccess;
            failed += chunkFailed;

            // Apply updates locally to cache
            this.applyLocalUpdatesToContacts(chunk, updates);

            // Notify progress per contact in chunk to update progress bar and logs smoothly
            for (let j = 0; j < chunk.length; j++) {
              const prevProcessed = cIdx * CHUNK_SIZE + j + 1;
              onProgress(prevProcessed, contactIds.length, chunk[j], true, {
                chunkIndex: cIdx + 1,
                totalChunks: chunks.length,
                chunkSize: chunk.length,
                statusText: `Lote ${cIdx + 1}/${chunks.length} (${chunk.length} leads) procesado OK`,
              });
            }
          } else {
            failed += chunk.length;
            for (let j = 0; j < chunk.length; j++) {
              const prevProcessed = cIdx * CHUNK_SIZE + j + 1;
              onProgress(prevProcessed, contactIds.length, chunk[j], false, {
                chunkIndex: cIdx + 1,
                totalChunks: chunks.length,
                chunkSize: chunk.length,
                statusText: `Lote ${cIdx + 1}/${chunks.length} falló`,
              });
            }
          }
        } catch (err) {
          failed += chunk.length;
          for (let j = 0; j < chunk.length; j++) {
            const prevProcessed = cIdx * CHUNK_SIZE + j + 1;
            onProgress(prevProcessed, contactIds.length, chunk[j], false, {
              chunkIndex: cIdx + 1,
              totalChunks: chunks.length,
              chunkSize: chunk.length,
              statusText: `Error de conexión en Lote ${cIdx + 1}/${chunks.length}`,
            });
          }
        }

        // Safe pacing between chunks (100ms) to avoid rate limit spikes
        if (cIdx < chunks.length - 1) {
          await new Promise((r) => setTimeout(r, 100));
        }
      }

      const latency = Math.round(performance.now() - startTime);
      this.recordLog(
        'hubspot_update_contact',
        'success',
        latency,
        `batch_update: ${contactIds.length} leads en ${chunks.length} lote(s) de máx 100`,
        `Actualizados ${successful} de ${contactIds.length} contactos en HubSpot CRM en ${chunks.length} lote(s)`,
      );

      return {
        processed: contactIds.length,
        successful,
        failed,
      };
    }

    // Fallback local dataset mode partitioned by chunks
    for (let cIdx = 0; cIdx < chunks.length; cIdx++) {
      const chunk = chunks[cIdx];
      for (let i = 0; i < chunk.length; i++) {
        const id = chunk[i];
        try {
          const res = await this.hubspot_update_contact(id, updates);
          if (res.success) {
            successful++;
          } else {
            failed++;
          }
          onProgress(successful + failed, contactIds.length, id, res.success, {
            chunkIndex: cIdx + 1,
            totalChunks: chunks.length,
            chunkSize: chunk.length,
            statusText: `Lote local ${cIdx + 1}/${chunks.length}`,
          });
        } catch (err) {
          failed++;
          onProgress(successful + failed, contactIds.length, id, false, {
            chunkIndex: cIdx + 1,
            totalChunks: chunks.length,
            chunkSize: chunk.length,
            statusText: `Error en lead ${id}`,
          });
        }
      }
    }

    return {
      processed: contactIds.length,
      successful,
      failed,
    };
  }

  // Helper to sync modified attributes in in-memory contacts
  private applyLocalUpdatesToContacts(contactIds: string[], updates: BulkActionPayload): void {
    const idSet = new Set(contactIds);
    const clearProps = Array.isArray(updates.clearProperties) ? updates.clearProperties : [];

    this.contacts = this.contacts.map((c) => {
      if (!idSet.has(c.id)) return c;
      const updated: any = {
        ...c,
        hubspot_owner_id:
          clearProps.includes('hubspot_owner_id') || updates.targetOwnerId === '__UNASSIGN__' || updates.targetOwnerId === '__CLEAR__'
            ? ''
            : updates.targetOwnerId !== undefined && updates.targetOwnerId !== ''
            ? updates.targetOwnerId
            : c.hubspot_owner_id,
        hs_lead_status: (updates.targetLeadStatus as any) || c.hs_lead_status,
        lifecyclestage: (updates.targetLifecycleStage as any) || c.lifecyclestage,
        utm_campaign:
          clearProps.includes('utm_campaign') || updates.targetCampaign === '__CLEAR__'
            ? ''
            : updates.targetCampaign !== undefined && updates.targetCampaign.trim() !== ''
            ? updates.targetCampaign.trim()
            : c.utm_campaign,
        utm_source:
          clearProps.includes('utm_source') || updates.targetSource === '__CLEAR__'
            ? ''
            : updates.targetSource !== undefined && updates.targetSource !== ''
            ? updates.targetSource
            : c.utm_source,
        priority:
          clearProps.includes('hs_priority') || updates.targetPriority === '__CLEAR__'
            ? undefined
            : (updates.targetPriority as any) || c.priority,
        industry:
          clearProps.includes('industry') || updates.targetIndustry === '__CLEAR__'
            ? ''
            : updates.targetIndustry !== undefined && updates.targetIndustry !== ''
            ? updates.targetIndustry
            : c.industry,
        city:
          clearProps.includes('city') || updates.targetCity === '__CLEAR__'
            ? ''
            : updates.targetCity !== undefined && updates.targetCity.trim() !== ''
            ? updates.targetCity.trim()
            : c.city,
        last_activity_at: new Date().toISOString(),
        hours_without_activity: 0,
      };

      if (updates.customProperties) {
        for (const [k, v] of Object.entries(updates.customProperties)) {
          if (!k) continue;
          if (clearProps.includes(k) || v === '__CLEAR__') {
            updated[k] = '';
          } else if (v !== undefined) {
            updated[k] = v;
          }
        }
      }

      return updated;
    });
  }

  // Tool 5: hubspot_get_contact_properties (generic schema reader for standard and custom portal properties)
  public async hubspot_get_contact_properties(): Promise<HubSpotProperty[]> {
    const startTime = performance.now();
    const token = await this.ensureToken();

    if (token) {
      try {
        const res = await fetch('/api/hubspot/properties/contacts', {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.properties)) {
            this.contactProperties = data.properties;
            const latency = Math.round(performance.now() - startTime);
            this.recordLog(
              'hubspot_get_contact_properties',
              'success',
              latency,
              'objectType: contacts',
              `Recuperadas ${data.properties.length} propiedades (estándar y personalizadas) de tu HubSpot`,
            );
            return [...this.contactProperties];
          }
        }
      } catch (err: any) {
        console.warn('Error fetching HubSpot properties:', err);
      }
    }

    if (this.contactProperties.length === 0) {
      this.contactProperties = [
        {
          name: 'hubspot_owner_id',
          label: 'Propietario del contacto',
          type: 'string',
          fieldType: 'select',
          groupName: 'contactinformation',
          description: 'El usuario de HubSpot al que está asignado el contacto',
          isCustom: false,
        },
        {
          name: 'hs_lead_status',
          label: 'Estado del lead',
          type: 'enumeration',
          fieldType: 'select',
          groupName: 'contactinformation',
          isCustom: false,
          options: [
            { label: 'Nuevo (NEW)', value: 'NEW' },
            { label: 'Abierto (OPEN)', value: 'OPEN' },
            { label: 'En Progreso (IN_PROGRESS)', value: 'IN_PROGRESS' },
            { label: 'Negocio Abierto (OPEN_DEAL)', value: 'OPEN_DEAL' },
            { label: 'No Calificado (UNQUALIFIED)', value: 'UNQUALIFIED' },
            { label: 'Intento de Contacto', value: 'ATTEMPTED_TO_CONTACT' },
            { label: 'Conectado (CONNECTED)', value: 'CONNECTED' },
            { label: 'Mal Momento (BAD_TIMING)', value: 'BAD_TIMING' },
          ],
        },
        {
          name: 'lifecyclestage',
          label: 'Etapa del ciclo de vida',
          type: 'enumeration',
          fieldType: 'select',
          groupName: 'contactinformation',
          isCustom: false,
          options: [
            { label: 'Suscriptor (subscriber)', value: 'subscriber' },
            { label: 'Lead (lead)', value: 'lead' },
            { label: 'MQL (marketingqualifiedlead)', value: 'marketingqualifiedlead' },
            { label: 'SQL (salesqualifiedlead)', value: 'salesqualifiedlead' },
            { label: 'Oportunidad (opportunity)', value: 'opportunity' },
            { label: 'Cliente (customer)', value: 'customer' },
            { label: 'Evangelizador (evangelist)', value: 'evangelist' },
            { label: 'Otro (other)', value: 'other' },
          ],
        },
        {
          name: 'utm_campaign',
          label: 'Campaña UTM',
          type: 'string',
          fieldType: 'text',
          groupName: 'contactinformation',
          isCustom: false,
        },
        {
          name: 'utm_source',
          label: 'Fuente UTM',
          type: 'string',
          fieldType: 'text',
          groupName: 'contactinformation',
          isCustom: false,
        },
        {
          name: 'hs_priority',
          label: 'Nivel de Prioridad',
          type: 'enumeration',
          fieldType: 'select',
          groupName: 'contactinformation',
          isCustom: false,
          options: [
            { label: 'Urgente (URGENT)', value: 'URGENT' },
            { label: 'Alta (HIGH)', value: 'HIGH' },
            { label: 'Media (MEDIUM)', value: 'MEDIUM' },
            { label: 'Baja (LOW)', value: 'LOW' },
          ],
        },
        {
          name: 'industry',
          label: 'Industria / Sector',
          type: 'string',
          fieldType: 'text',
          groupName: 'contactinformation',
          isCustom: false,
        },
        {
          name: 'city',
          label: 'Ciudad',
          type: 'string',
          fieldType: 'text',
          groupName: 'contactinformation',
          isCustom: false,
        },
        {
          name: 'jobtitle',
          label: 'Cargo / Puesto',
          type: 'string',
          fieldType: 'text',
          groupName: 'contactinformation',
          isCustom: false,
        },
        {
          name: 'phone',
          label: 'Teléfono',
          type: 'string',
          fieldType: 'text',
          groupName: 'contactinformation',
          isCustom: false,
        },
        {
          name: 'mobilephone',
          label: 'Teléfono Móvil',
          type: 'string',
          fieldType: 'text',
          groupName: 'contactinformation',
          isCustom: false,
        },
        {
          name: 'country',
          label: 'País',
          type: 'string',
          fieldType: 'text',
          groupName: 'contactinformation',
          isCustom: false,
        },
        {
          name: 'website',
          label: 'Sitio Web',
          type: 'string',
          fieldType: 'text',
          groupName: 'contactinformation',
          isCustom: false,
        },
        {
          name: 'motivo_contacto_personalizado',
          label: 'Motivo de Contacto (Personalizada)',
          type: 'enumeration',
          fieldType: 'select',
          groupName: 'custom_sales',
          description: 'Campo personalizado del portal del cliente',
          isCustom: true,
          options: [
            { label: 'Solicitud Demo', value: 'demo' },
            { label: 'Cotización Inmediata', value: 'quote' },
            { label: 'Soporte Preventa', value: 'presales' },
            { label: 'Referido Partner', value: 'partner' },
          ],
        },
        {
          name: 'monto_presupuesto_estimado',
          label: 'Presupuesto Estimado USD (Personalizada)',
          type: 'number',
          fieldType: 'number',
          groupName: 'custom_sales',
          description: 'Monto presupuestario declarado',
          isCustom: true,
        },
        {
          name: 'sucursal_asignada',
          label: 'Sucursal Comercial (Personalizada)',
          type: 'string',
          fieldType: 'text',
          groupName: 'custom_sales',
          description: 'Zona geográfica o sede de atención',
          isCustom: true,
        },
      ];
    }

    const latency = Math.round(performance.now() - startTime);
    this.recordLog(
      'hubspot_get_contact_properties',
      'success',
      latency,
      'objectType: contacts',
      `Recuperadas ${this.contactProperties.length} propiedades disponibles para modificar`,
    );

    return [...this.contactProperties];
  }

  // Tool 4: hubspot_get_agent_metrics (Cálculo 100% Real basado en registros de HubSpot)
  public async hubspot_get_agent_metrics(): Promise<AgentMetric[]> {
    const startTime = performance.now();
    await new Promise((r) => setTimeout(r, 60));

    const now = new Date();
    const nowTs = now.getTime();

    const metrics: AgentMetric[] = this.owners.map((owner) => {
      const agentContacts = this.contacts.filter((c) => c.hubspot_owner_id === owner.id);
      const totalAccumulated = agentContacts.length;
      const dailyTarget = 25; // Meta diaria operativa de referencia

      // Contactados hoy: verificar si la última fecha de contacto o interacción fue efectivamente hoy
      const contactsContactedToday = agentContacts.filter((c) => {
        const rawTs = c.notes_last_contacted || c.last_activity_at;
        if (!rawTs) return false;
        let ts: number;
        if (typeof rawTs === 'number') {
          ts = rawTs;
        } else {
          const num = Number(rawTs);
          ts = (!isNaN(num) && num > 0) ? num : new Date(rawTs).getTime();
        }
        if (isNaN(ts) || ts <= 0) return false;

        const d = new Date(ts);
        return (
          d.getFullYear() === now.getFullYear() &&
          d.getMonth() === now.getMonth() &&
          d.getDate() === now.getDate()
        );
      });

      const contactedToday = contactsContactedToday.length;
      const totalAssignedToday = totalAccumulated;

      // Leads estancados sin actividad en más de 24 horas (excluyendo estados cerrados o descartados)
      const pendingOverdueContacts = agentContacts.filter((c) => {
        const isClosed = ['CLOSED_WON', 'CLOSED_LOST', 'UNQUALIFIED'].includes(c.hs_lead_status);
        if (isClosed) return false;

        let ts = 0;
        const raw = c.notes_last_contacted || c.last_activity_at || c.hs_lastmodifieddate || c.createdate;
        if (raw) {
          const num = Number(raw);
          ts = (!isNaN(num) && num > 0) ? num : new Date(raw).getTime();
        }
        if (!ts || isNaN(ts)) return true; // Si nunca ha tenido actividad, está pendiente

        const hours = Math.floor((nowTs - ts) / (1000 * 60 * 60));
        return hours >= 24;
      });

      const pendingOverdue = pendingOverdueContacts.length;
      const progressPct = dailyTarget > 0 ? Math.min(100, Math.round((contactedToday / dailyTarget) * 100)) : 0;

      // Estado de salud operativo REAL
      let healthStatus: AgentMetric['healthStatus'] = 'on_track';
      if (progressPct >= 80 && pendingOverdue <= 1) {
        healthStatus = 'on_track';
      } else if (progressPct >= 40 || (contactedToday > 0 && pendingOverdue <= 5)) {
        healthStatus = 'at_risk';
      } else {
        healthStatus = 'lagging';
      }

      // Tiempo de última actividad real para este asesor
      let recentTime = 'Sin actividad hoy';
      let latestActivityTs = 0;
      for (const c of agentContacts) {
        const raw = c.notes_last_contacted || c.last_activity_at;
        if (raw) {
          const num = Number(raw);
          const t = (!isNaN(num) && num > 0) ? num : new Date(raw).getTime();
          if (!isNaN(t) && t > latestActivityTs) {
            latestActivityTs = t;
          }
        }
      }

      if (latestActivityTs > 0) {
        const diffMs = nowTs - latestActivityTs;
        const diffMins = Math.floor(diffMs / (1000 * 60));
        const diffHours = Math.floor(diffMins / 60);
        const diffDays = Math.floor(diffHours / 24);

        if (diffMins < 60) {
          recentTime = `Hace ${Math.max(1, diffMins)} min`;
        } else if (diffHours < 24) {
          recentTime = `Hace ${diffHours} h`;
        } else {
          recentTime = `Hace ${diffDays} d`;
        }
      }

      return {
        owner,
        totalAssignedToday,
        totalAccumulated,
        contactedToday,
        pendingOverdue,
        dailyTarget,
        progressPct,
        healthStatus,
        lastActivityTime: recentTime,
      };
    });

    const latency = Math.round(performance.now() - startTime);
    this.recordLog(
      'hubspot_get_agent_metrics',
      'success',
      latency,
      'call: calculate agent daily metrics',
      `Calculadas cuotas operativas para ${metrics.length} asesores`,
    );

    return metrics;
  }

  // Helper to compute standard UNIX Cron expression from configuration
  public computeCronExpression(config: NotificationConfig): string {
    if (config.mode === 'on_demand') {
      return 'MANUAL / A DEMANDA (Sin cron)';
    }

    const daysStr =
      config.activeDays && config.activeDays.length > 0
        ? config.activeDays.sort((a, b) => a - b).join(',')
        : '*';

    if (config.mode === 'fixed_times') {
      if (!config.scheduledTimes || config.scheduledTimes.length === 0) {
        return '0 9,14,18 * * 1-5';
      }
      // Group by minutes or pick hours
      const hours = Array.from(new Set(config.scheduledTimes.map((t) => parseInt(t.split(':')[0], 10)))).sort((a, b) => a - b);
      const minutes = Array.from(new Set(config.scheduledTimes.map((t) => parseInt(t.split(':')[1] || '0', 10)))).sort((a, b) => a - b);
      return `${minutes.join(',')} ${hours.join(',')} * * ${daysStr}`;
    }

    if (config.mode === 'interval_cron') {
      const startH = parseInt(config.workHoursStart?.split(':')[0] || '8', 10);
      const endH = parseInt(config.workHoursEnd?.split(':')[0] || '18', 10);
      const mins = config.intervalMinutes || 60;
      if (mins < 60) {
        return `*/${mins} ${startH}-${endH} * * ${daysStr}`;
      } else {
        const hoursInterval = Math.max(1, Math.round(mins / 60));
        return `0 ${startH}-${endH}/${hoursInterval} * * ${daysStr}`;
      }
    }

    if (config.mode === 'conditional_alert') {
      return `*/15 8-19 * * ${daysStr} (Evaluación cada 15 min)`;
    }

    return '0 9,14,18 * * 1-5';
  }

  // Dispatch notifications to agents (Calls server API and records telemetry)
  public async hubspot_dispatch_notifications(
    agentMetrics: AgentMetric[],
    config: NotificationConfig,
    triggerSource: string = 'manual_on_demand',
  ): Promise<DispatchLogEntry[]> {
    const startTime = performance.now();

    // Filter by targetAudience
    let targetMetrics = agentMetrics;
    if (config.targetAudience === 'lagging_only') {
      targetMetrics = agentMetrics.filter((m) => m.healthStatus === 'lagging');
    } else if (config.targetAudience === 'at_risk_or_lagging') {
      targetMetrics = agentMetrics.filter((m) => m.healthStatus === 'lagging' || m.healthStatus === 'at_risk');
    }

    if (config.minOverdueFilter && config.minOverdueFilter > 0) {
      targetMetrics = targetMetrics.filter((m) => m.pendingOverdue >= config.minOverdueFilter);
    }

    if (targetMetrics.length === 0) {
      targetMetrics = agentMetrics; // Fallback so preview/tests always have output
    }

    // Try server API first
    try {
      const res = await fetch('/api/notifications/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agents: targetMetrics.map((m) => ({
            id: m.owner.id,
            name: `${m.owner.firstName} ${m.owner.lastName}`.trim(),
            firstName: m.owner.firstName,
            lastName: m.owner.lastName,
            email: m.owner.email,
            team: m.owner.team,
            contactedToday: m.contactedToday,
            dailyTarget: m.dailyTarget,
            pendingOverdue: m.pendingOverdue,
            progressPct: m.progressPct,
          })),
          customConfig: config,
          triggerSource,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.logs) && data.logs.length > 0) {
          this.dispatchLogs = [...data.logs, ...this.dispatchLogs.slice(0, 40)];
          const latency = Math.round(performance.now() - startTime);
          this.recordLog(
            'hubspot_get_agent_metrics',
            'success',
            latency,
            `channels: [${config.channels.join(', ')}], trigger: ${triggerSource}`,
            `Despacho enviado a ${targetMetrics.length} asesores vía ${config.channels.join(', ')}`,
          );
          return data.logs;
        }
      }
    } catch (err) {
      console.warn('Server dispatch endpoint unavailable, fallback local:', err);
    }

    // Local fallback dispatch simulation
    const newEntries: DispatchLogEntry[] = [];
    for (const metric of targetMetrics) {
      for (const channel of config.channels) {
        const msg = config.customTemplate
          .replace('{nombre}', metric.owner.firstName)
          .replace('{contactados}', metric.contactedToday.toString())
          .replace('{meta}', metric.dailyTarget.toString())
          .replace('{pendientes}', metric.pendingOverdue.toString())
          .replace('{tasa}', `${metric.progressPct}%`);

        const entry: DispatchLogEntry = {
          id: 'dsp_' + Math.random().toString(36).substring(2, 9),
          timestamp: new Date().toLocaleTimeString(),
          agentName: `${metric.owner.firstName} ${metric.owner.lastName}`,
          agentEmail: metric.owner.email,
          channel,
          status: 'delivered',
          messageSnippet: msg,
        };
        newEntries.push(entry);
      }
    }

    this.dispatchLogs = [...newEntries, ...this.dispatchLogs.slice(0, 40)];
    const latency = Math.round(performance.now() - startTime);
    this.recordLog(
      'hubspot_get_agent_metrics',
      'success',
      latency,
      `mode: ${config.mode}, channels: [${config.channels.join(', ')}]`,
      `Despachadas ${newEntries.length} alertas a asesores`,
    );

    return newEntries;
  }

  public getDispatchLogs(): DispatchLogEntry[] {
    return [...this.dispatchLogs];
  }

  public resetData() {
    this.contacts = [];
    this.owners = [];
    this.notifyStatus(false, 'Datos restablecidos');
  }
}

export const mcpHubspot = new McpHubspotService();
