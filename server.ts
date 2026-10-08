import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import { createClient } from '@supabase/supabase-js';
import {
  executeHubSpotReportGeneration,
  HubSpotReportOwner,
  ReportGenerationOptions,
} from './src/services/hubspotExcelReporter';

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  "https://dhbdgmuuciwosiwpznrs.supabase.co";

const SUPABASE_ANON =
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRoYmRnbXV1Y2l3b3Npd3B6bnJzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA2ODM3ODQsImV4cCI6MjA2NjI1OTc4NH0.Qh9g4FWSYKZcOOYm7WJeJyv1QgI2r5ZDn7CcU3oT7gs";

const supabaseServer = createClient(SUPABASE_URL, SUPABASE_ANON);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // CORS headers allowing frontend connection from any port, Nginx proxy or domain
  app.use((req: Request, res: Response, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-client-id, x-hubspot-token');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // Helper to extract or resolve HubSpot Token from request headers OR directly from the 'companies' table in Supabase
  const getHubSpotToken = async (req: Request): Promise<string> => {
    // 1. Authorization header: Bearer <token>
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const bearer = authHeader.substring(7).trim();
      if (bearer && bearer !== 'undefined' && bearer !== 'null' && bearer !== '') {
        return bearer;
      }
    }

    // 2. Custom header
    const customHeader = (req.headers['x-hubspot-token'] as string) || '';
    if (customHeader && customHeader !== 'undefined' && customHeader !== 'null') {
      return customHeader.trim();
    }

    // 3. Body token
    if (req.body && req.body.token && typeof req.body.token === 'string') {
      const bToken = req.body.token.trim();
      if (bToken && bToken !== 'undefined' && bToken !== 'null') {
        return bToken;
      }
    }

    // 4. Query param token
    if (req.query && req.query.token && typeof req.query.token === 'string') {
      const qToken = req.query.token.trim();
      if (qToken && qToken !== 'undefined' && qToken !== 'null') {
        return qToken;
      }
    }

    // 5. OBTENER DINÁMICAMENTE DE LA TABLA 'companies' EN SUPABASE PARA EL CLIENTE_ID
    try {
      const rawClientId =
        (req.headers['x-client-id'] as string) ||
        (req.query.clientId as string) ||
        (req.query.client_id as string) ||
        (req.body?.clientId) ||
        (req.body?.client_id);

      if (rawClientId) {
        const compIdNum = Number(rawClientId);
        if (!isNaN(compIdNum)) {
          const { data } = await supabaseServer
            .from('companies')
            .select('id, hubspot_token')
            .eq('id', compIdNum)
            .maybeSingle();

          if (data?.hubspot_token && data.hubspot_token.trim().length > 0) {
            return data.hubspot_token.trim();
          }
        }

        // Buscar por public_client_id si es string
        const { data: byPublic } = await supabaseServer
          .from('companies')
          .select('id, hubspot_token')
          .eq('public_client_id', String(rawClientId))
          .maybeSingle();

        if (byPublic?.hubspot_token && byPublic.hubspot_token.trim().length > 0) {
          return byPublic.hubspot_token.trim();
        }
      }

      // Si no se especificó clientId o no tenía token, obtener la primera empresa activa con hubspot_token
      const { data: defaultCompany } = await supabaseServer
        .from('companies')
        .select('id, hubspot_token')
        .not('hubspot_token', 'is', null)
        .neq('hubspot_token', '')
        .order('id', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (defaultCompany?.hubspot_token && defaultCompany.hubspot_token.trim().length > 0) {
        return defaultCompany.hubspot_token.trim();
      }
    } catch (err: any) {
      console.warn('[Server] Error al consultar hubspot_token en companies de Supabase:', err.message);
    }

    // 6. Fallback final opcional (variable de entorno)
    return process.env.HUBSPOT_ACCESS_TOKEN || '';
  };

  // Health route
  app.get('/api/health', (req: Request, res: Response) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  // Status route to inform if a token exists in DB companies or headers
  app.get('/api/hubspot/status', async (req: Request, res: Response) => {
    const token = await getHubSpotToken(req);
    res.json({
      success: true,
      hasToken: Boolean(token && token.length > 5),
      tokenPrefix: token ? token.substring(0, 8) + '...' : null,
    });
  });

  // Verify HubSpot Token
  app.post('/api/hubspot/verify', async (req: Request, res: Response) => {
    const token = await getHubSpotToken(req);
    if (!token) {
      return res.status(400).json({
        success: false,
        error: 'No se proveyó ningún token de HubSpot (Private App Token).',
      });
    }

    try {
      const response = await fetch('https://api.hubapi.com/crm/v3/owners/?limit=5', {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorBody = await response.text();
        let parsedError = errorBody;
        try {
          parsedError = JSON.parse(errorBody);
        } catch (_) {}

        return res.status(response.status).json({
          success: false,
          statusCode: response.status,
          error:
            response.status === 401
              ? 'Token inválido o expirado. Verifica que sea un Private App Token válido de tu portal HubSpot.'
              : response.status === 403
              ? 'Token no tiene permisos suficientes. Asegúrate de otorgar los scopes: crm.objects.owners.read, crm.objects.contacts.read, crm.objects.contacts.write.'
              : 'Error al conectar con HubSpot API.',
          details: parsedError,
        });
      }

      const data = await response.json();
      return res.json({
        success: true,
        message: '¡Conexión verificada exitosamente con HubSpot CRM!',
        ownersCount: data.results ? data.results.length : 0,
      });
    } catch (err: any) {
      return res.status(500).json({
        success: false,
        error: `Error de red al conectar con api.hubapi.com: ${err.message}`,
      });
    }
  });

  // Fetch Owners from real HubSpot API
  app.get('/api/hubspot/owners', async (req: Request, res: Response) => {
    const token = await getHubSpotToken(req);
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Token no provisto en la cabecera Authorization.',
      });
    }

    try {
      const response = await fetch('https://api.hubapi.com/crm/v3/owners/?limit=100', {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        return res.status(response.status).json({
          success: false,
          error: `Error ${response.status} de HubSpot al obtener owners: ${errorText}`,
        });
      }

      const data = await response.json();
      const rawOwners = data.results || [];

      const formattedOwners = rawOwners.map((o: any, idx: number) => ({
        id: String(o.id),
        firstName: o.firstName || 'Asesor',
        lastName: o.lastName || `#${o.id}`,
        email: o.email || '',
        active: !o.archived,
        team: o.teams && o.teams.length > 0 ? o.teams[0].name : 'Comercial HubSpot',
        avatarUrl: `https://images.unsplash.com/photo-${
          [
            '1534528741775-53994a69daeb',
            '1573496359142-b8d87734a5a2',
            '1580489944761-15a19d654956',
            '1507003211169-0a1dd7228f2d',
            '1544005313-94ddf0286df2',
          ][idx % 5]
        }?w=150&auto=format&fit=crop&q=80`,
      }));

      return res.json({
        success: true,
        owners: formattedOwners,
      });
    } catch (err: any) {
      return res.status(500).json({
        success: false,
        error: `Fallo al consultar owners en HubSpot: ${err.message}`,
      });
    }
  });

  // Search Contacts in real HubSpot API
  app.post('/api/hubspot/contacts/search', async (req: Request, res: Response) => {
    const token = await getHubSpotToken(req);
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Token no provisto.',
      });
    }

    const {
      ownerId,
      leadStatus,
      lifecycleStage,
      campaign,
      source,
      priority,
      industry,
      dateRange,
      inactivityRange,
      searchKeyword,
      extraProperties,
    } = req.body || {};

    // Build HubSpot CRM v3 search filters
    const filters: any[] = [];
    if (ownerId && ownerId !== 'ALL') {
      if (ownerId === '__UNASSIGNED__') {
        filters.push({ propertyName: 'hubspot_owner_id', operator: 'NOT_HAS_PROPERTY' });
      } else {
        filters.push({ propertyName: 'hubspot_owner_id', operator: 'EQ', value: ownerId });
      }
    }
    if (leadStatus && leadStatus !== 'ALL') {
      filters.push({ propertyName: 'hs_lead_status', operator: 'EQ', value: leadStatus });
    }
    if (lifecycleStage && lifecycleStage !== 'ALL') {
      filters.push({ propertyName: 'lifecyclestage', operator: 'EQ', value: lifecycleStage });
    }
    if (campaign && campaign !== 'ALL') {
      filters.push({ propertyName: 'utm_campaign', operator: 'EQ', value: campaign });
    }
    if (source && source !== 'ALL') {
      filters.push({ propertyName: 'utm_source', operator: 'EQ', value: source });
    }
    if (priority && priority !== 'ALL') {
      filters.push({ propertyName: 'hs_priority', operator: 'EQ', value: priority });
    }
    if (industry && industry !== 'ALL') {
      filters.push({ propertyName: 'industry', operator: 'EQ', value: industry });
    }
    if (dateRange && dateRange !== 'ALL') {
      const now = Date.now();
      let startTimestamp: number | null = null;
      if (dateRange === 'today') {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        startTimestamp = d.getTime();
      } else if (dateRange === 'last_7d') {
        startTimestamp = now - 7 * 24 * 60 * 60 * 1000;
      } else if (dateRange === 'last_30d') {
        startTimestamp = now - 30 * 24 * 60 * 60 * 1000;
      } else if (dateRange === 'last_365d' || dateRange === 'last_year') {
        startTimestamp = now - 365 * 24 * 60 * 60 * 1000;
      }
      if (startTimestamp) {
        filters.push({ propertyName: 'createdate', operator: 'GTE', value: String(startTimestamp) });
      }
    }

    const requestedProps = [
      'firstname',
      'lastname',
      'email',
      'phone',
      'company',
      'city',
      'country',
      'industry',
      'hs_lead_status',
      'lifecyclestage',
      'hubspot_owner_id',
      'utm_campaign',
      'utm_source',
      'canal',
      'fuente',
      'lead_source',
      'hs_analytics_source',
      'hs_analytics_source_data_1',
      'hs_priority',
      'createdate',
      'hs_lastmodifieddate',
      'notes_last_contacted',
    ];

    if (Array.isArray(extraProperties)) {
      for (const ep of extraProperties) {
        if (typeof ep === 'string' && ep.trim() && !requestedProps.includes(ep.trim())) {
          requestedProps.push(ep.trim());
        }
      }
    }

    const searchPayload: any = {
      properties: requestedProps,
      limit: 100,
    };

    if (filters.length > 0) {
      searchPayload.filterGroups = [{ filters }];
    }

    if (searchKeyword && searchKeyword.trim()) {
      searchPayload.query = searchKeyword.trim();
    }

    try {
      const allRawResults: any[] = [];
      let afterCursor: string | undefined = undefined;
      let hasMore = true;
      let reportedTotal = 0;
      let pageCount = 0;
      const MAX_TOTAL_CONTACTS = 10000; // HubSpot CRM search API max ceiling

      // Auto-paginate across all pages of 100 contacts until all are retrieved
      while (hasMore && allRawResults.length < MAX_TOTAL_CONTACTS) {
        pageCount++;
        const currentPayload: any = {
          ...searchPayload,
          limit: 100,
        };
        if (afterCursor) {
          currentPayload.after = afterCursor;
        }

        const response = await fetch('https://api.hubapi.com/crm/v3/objects/contacts/search', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(currentPayload),
        });

        if (!response.ok) {
          // If we already collected some pages and hit an issue or rate limit on a later page, preserve what we collected
          if (allRawResults.length > 0) {
            console.warn(`HubSpot search paging interrupted at page ${pageCount}: status ${response.status}`);
            break;
          }
          const errText = await response.text();
          return res.status(response.status).json({
            success: false,
            error: `Error ${response.status} de HubSpot al buscar contactos: ${errText}`,
          });
        }

        const data = await response.json();
        reportedTotal = data.total || reportedTotal || 0;
        const pageResults = data.results || [];
        allRawResults.push(...pageResults);

        // Check if HubSpot returned pagination cursor for the next page
        if (data.paging?.next?.after && pageResults.length > 0) {
          afterCursor = String(data.paging.next.after);
          // Safety pause between page requests (40ms) to respect HubSpot secondary rate limits
          await new Promise((resolve) => setTimeout(resolve, 40));
        } else {
          hasMore = false;
        }
      }

      let results = (allRawResults || []).map((c: any) => {
        const props = c.properties || {};

        // Parse last contact / activity timestamp reliably (HubSpot returns milliseconds string for notes_last_contacted)
        const parseHubSpotTimestamp = (val: any): number => {
          if (!val) return 0;
          if (typeof val === 'number') return val;
          const num = Number(val);
          if (!isNaN(num) && num > 0) return num;
          const t = new Date(val).getTime();
          return isNaN(t) ? 0 : t;
        };

        const contactTs = parseHubSpotTimestamp(props.notes_last_contacted);
        const modTs = parseHubSpotTimestamp(props.hs_lastmodifieddate);
        const createTs = parseHubSpotTimestamp(props.createdate);
        const effectiveLastTs = contactTs || modTs || createTs || Date.now();

        const diffHours = Math.max(
          0,
          Math.round((Date.now() - effectiveLastTs) / (1000 * 60 * 60))
        );

        return {
          id: String(c.id),
          ...props,
          firstname: props.firstname || 'Sin nombre',
          lastname: props.lastname || '',
          email: props.email || 'sin-email@dominio.com',
          phone: props.phone || '',
          company: props.company || 'Empresa no especificada',
          city: props.city || '',
          country: props.country || '',
          industry: props.industry || '',
          hs_lead_status: props.hs_lead_status || 'NEW',
          lifecyclestage: props.lifecyclestage || 'lead',
          hubspot_owner_id: props.hubspot_owner_id || '',
          utm_campaign: props.utm_campaign || 'organico',
          utm_source:
            props.utm_source ||
            props.fuente ||
            props.canal ||
            props.lead_source ||
            (props.hs_analytics_source === 'OFFLINE'
              ? (props.hs_analytics_source_data_1 ? `Offline (${props.hs_analytics_source_data_1})` : 'Fuentes sin conexión (Offline)')
              : props.hs_analytics_source) ||
            '',
          priority: props.hs_priority || 'MEDIUM',
          createdate: props.createdate || new Date().toISOString(),
          notes_last_contacted: props.notes_last_contacted || null,
          last_activity_at: new Date(effectiveLastTs).toISOString(),
          hours_without_activity: diffHours,
        };
      });

      // Apply in-memory inactivity range filter if requested
      if (inactivityRange && inactivityRange !== 'ALL') {
        if (inactivityRange === 'overdue_24h') results = results.filter((c) => c.hours_without_activity > 24);
        else if (inactivityRange === 'overdue_48h') results = results.filter((c) => c.hours_without_activity > 48);
        else if (inactivityRange === 'overdue_7d') results = results.filter((c) => c.hours_without_activity > 168);
        else if (inactivityRange === 'recent_12h') results = results.filter((c) => c.hours_without_activity <= 12);
      }

      return res.json({
        success: true,
        total: results.length,
        hubspotReportedTotal: reportedTotal,
        pagesFetched: pageCount,
        contacts: results,
      });
    } catch (err: any) {
      return res.status(500).json({
        success: false,
        error: `Fallo al buscar contactos en HubSpot: ${err.message}`,
      });
    }
  });

  // Retrieve contact properties (both standard and custom properties defined in client's portal)
  app.get('/api/hubspot/properties/contacts', async (req: Request, res: Response) => {
    const token = await getHubSpotToken(req);
    if (!token) {
      return res.status(401).json({ success: false, error: 'Token requerido.' });
    }

    try {
      const response = await fetch('https://api.hubapi.com/crm/v3/properties/contacts', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const errText = await response.text();
        return res.status(response.status).json({
          success: false,
          error: `Error ${response.status} de HubSpot al obtener propiedades: ${errText}`,
        });
      }

      const data = await response.json();
      // Filter to editable properties (exclude read-only, calculated, or hidden)
      const properties = (data.results || [])
        .filter((p: any) => !p.modificationMetadata?.readOnlyValue && !p.calculated && !p.hidden)
        .map((p: any) => ({
          name: p.name,
          label: p.label,
          type: p.type,
          fieldType: p.fieldType,
          groupName: p.groupName || 'contactinformation',
          description: p.description || '',
          readOnlyValue: Boolean(p.modificationMetadata?.readOnlyValue),
          calculated: Boolean(p.calculated),
          isCustom: !p.hubspotDefined,
          options: (p.options || []).map((opt: any) => ({
            label: opt.label,
            value: opt.value,
            displayOrder: opt.displayOrder,
            hidden: opt.hidden,
          })),
        }))
        .sort((a: any, b: any) => {
          // Custom properties first or alphabetical by label
          if (a.isCustom && !b.isCustom) return -1;
          if (!a.isCustom && b.isCustom) return 1;
          return a.label.localeCompare(b.label);
        });

      return res.json({
        success: true,
        total: properties.length,
        properties,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Update a single contact in HubSpot
  app.patch('/api/hubspot/contacts/:id', async (req: Request, res: Response) => {
    const token = await getHubSpotToken(req);
    if (!token) {
      return res.status(401).json({ success: false, error: 'Token requerido.' });
    }

    const { id } = req.params;
    const { properties } = req.body || {};

    if (!properties || Object.keys(properties).length === 0) {
      return res.status(400).json({ success: false, error: 'No se enviaron propiedades a actualizar.' });
    }

    try {
      const response = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/${id}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ properties }),
      });

      if (!response.ok) {
        const errText = await response.text();
        return res.status(response.status).json({
          success: false,
          error: `Error ${response.status} de HubSpot: ${errText}`,
        });
      }

      const data = await response.json();
      return res.json({ success: true, contact: data });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Batch update contacts in HubSpot partitioned in safe chunks of 100 with rate limiting
  app.post('/api/hubspot/contacts/batch-update', async (req: Request, res: Response) => {
    const token = await getHubSpotToken(req);
    if (!token) {
      return res.status(401).json({ success: false, error: 'Token requerido.' });
    }

    const { contactIds, updates } = req.body || {};
    if (!contactIds || !Array.isArray(contactIds) || contactIds.length === 0) {
      return res.status(400).json({ success: false, error: 'Lista de IDs vacía.' });
    }

    // Build payload properties
    const propsToUpdate: Record<string, string> = {};
    const clearProperties: string[] = Array.isArray(updates.clearProperties) ? updates.clearProperties : [];

    if (clearProperties.includes('hubspot_owner_id') || updates.targetOwnerId === '__UNASSIGN__' || updates.targetOwnerId === '__CLEAR__') {
      propsToUpdate['hubspot_owner_id'] = '';
    } else if (updates.targetOwnerId !== undefined && updates.targetOwnerId !== '') {
      propsToUpdate['hubspot_owner_id'] = updates.targetOwnerId;
    }

    if (updates.targetLeadStatus) propsToUpdate['hs_lead_status'] = updates.targetLeadStatus;
    if (updates.targetLifecycleStage) propsToUpdate['lifecyclestage'] = updates.targetLifecycleStage;

    if (clearProperties.includes('utm_campaign') || updates.targetCampaign === '__CLEAR__') {
      propsToUpdate['utm_campaign'] = '';
    } else if (updates.targetCampaign !== undefined && updates.targetCampaign.trim() !== '') {
      propsToUpdate['utm_campaign'] = updates.targetCampaign.trim();
    }

    if (clearProperties.includes('utm_source') || updates.targetSource === '__CLEAR__') {
      propsToUpdate['utm_source'] = '';
    } else if (updates.targetSource !== undefined && updates.targetSource !== '') {
      propsToUpdate['utm_source'] = updates.targetSource;
    }

    if (clearProperties.includes('hs_priority') || updates.targetPriority === '__CLEAR__') {
      propsToUpdate['hs_priority'] = '';
    } else if (updates.targetPriority !== undefined && updates.targetPriority !== '') {
      propsToUpdate['hs_priority'] = updates.targetPriority;
    }

    if (clearProperties.includes('industry') || updates.targetIndustry === '__CLEAR__') {
      propsToUpdate['industry'] = '';
    } else if (updates.targetIndustry !== undefined && updates.targetIndustry !== '') {
      propsToUpdate['industry'] = updates.targetIndustry;
    }

    if (clearProperties.includes('city') || updates.targetCity === '__CLEAR__') {
      propsToUpdate['city'] = '';
    } else if (updates.targetCity !== undefined && updates.targetCity.trim() !== '') {
      propsToUpdate['city'] = updates.targetCity.trim();
    }

    // Support any custom or dynamic properties defined by the user
    if (updates.customProperties && typeof updates.customProperties === 'object') {
      for (const [propName, propVal] of Object.entries(updates.customProperties)) {
        if (!propName) continue;
        if (clearProperties.includes(propName) || propVal === '__CLEAR__') {
          propsToUpdate[propName] = '';
        } else if (propVal !== undefined && propVal !== null && propVal !== '') {
          propsToUpdate[propName] = String(propVal);
        }
      }
    }

    if (Object.keys(propsToUpdate).length === 0) {
      return res.status(400).json({ success: false, error: 'No se definieron propiedades para actualizar.' });
    }

    // HubSpot Batch Update endpoint limit: strictly max 100 objects per request
    const CHUNK_SIZE = 100;
    const chunks: string[][] = [];
    for (let i = 0; i < contactIds.length; i += CHUNK_SIZE) {
      chunks.push(contactIds.slice(i, i + CHUNK_SIZE));
    }

    const aggregatedResults: any[] = [];
    const chunkErrors: string[] = [];
    let successfulCount = 0;
    let failedCount = 0;

    // Process chunk by chunk sequentially
    for (let cIdx = 0; cIdx < chunks.length; cIdx++) {
      const currentChunk = chunks[cIdx];
      const batchInputs = currentChunk.map((id: string) => ({
        id,
        properties: propsToUpdate,
      }));

      try {
        const response = await fetch('https://api.hubapi.com/crm/v3/objects/contacts/batch/update', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ inputs: batchInputs }),
        });

        if (!response.ok) {
          const errText = await response.text();
          chunkErrors.push(`Lote ${cIdx + 1}/${chunks.length} error (${response.status}): ${errText}`);
          failedCount += currentChunk.length;
        } else {
          const data = await response.json();
          const chunkRes = data.results || [];
          successfulCount += chunkRes.length > 0 ? chunkRes.length : currentChunk.length;
          aggregatedResults.push(...chunkRes);
        }
      } catch (err: any) {
        chunkErrors.push(`Lote ${cIdx + 1}/${chunks.length} fallo de conexión: ${err.message}`);
        failedCount += currentChunk.length;
      }

      // Safe pause between batch chunks (100ms) to respect HubSpot rate limits
      if (cIdx < chunks.length - 1) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    return res.json({
      success: successfulCount > 0,
      totalRequested: contactIds.length,
      totalChunks: chunks.length,
      chunkSize: CHUNK_SIZE,
      processed: successfulCount + failedCount,
      successful: successfulCount,
      failed: failedCount,
      errors: chunkErrors.length > 0 ? chunkErrors : undefined,
      results: aggregatedResults,
    });
  });

  // --- Flexible Notification Scheduler Endpoints ---
  let currentNotificationConfig: any = {
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
    lastDispatchedAt: null,
  };

  let notificationDispatchLogs: any[] = [];

  // Get Notification Config
  app.get('/api/notifications/config', (req: Request, res: Response) => {
    res.json({ success: true, config: currentNotificationConfig });
  });

  // Save Notification Config
  app.post('/api/notifications/config', (req: Request, res: Response) => {
    const newConfig = req.body || {};
    currentNotificationConfig = {
      ...currentNotificationConfig,
      ...newConfig,
      lastUpdatedAt: new Date().toISOString(),
    };
    res.json({
      success: true,
      message: 'Configuración del planificador de notificaciones guardada exitosamente.',
      config: currentNotificationConfig,
    });
  });

  // Dispatch Notifications (On-demand or via Cron / Webhook Trigger)
  app.post('/api/notifications/dispatch', async (req: Request, res: Response) => {
    const { agents, customConfig, triggerSource } = req.body || {};
    const effectiveConfig = customConfig || currentNotificationConfig;
    const targetAgents = Array.isArray(agents) && agents.length > 0 ? agents : [];

    const newLogs: any[] = [];

    for (const agent of targetAgents) {
      const msg = effectiveConfig.customTemplate
        .replace('{nombre}', agent.name || agent.firstName || 'Asesor')
        .replace('{contactados}', String(agent.contactedToday ?? 0))
        .replace('{meta}', String(agent.dailyTarget ?? 25))
        .replace('{pendientes}', String(agent.pendingOverdue ?? 0))
        .replace('{tasa}', `${agent.progressPct ?? 0}%`);

      for (const channel of effectiveConfig.channels || ['slack']) {
        let status = 'delivered';
        let channelDetails = '';

        // If webhook channel is active and URL is set, perform actual HTTP POST
        if (channel === 'webhook' && effectiveConfig.webhookUrl) {
          try {
            await fetch(effectiveConfig.webhookUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                event: 'hubops.agent_notification',
                trigger: triggerSource || 'manual_or_cron',
                agent: {
                  id: agent.id,
                  name: agent.name || agent.firstName,
                  email: agent.email,
                  team: agent.team,
                },
                metrics: {
                  contactedToday: agent.contactedToday,
                  dailyTarget: agent.dailyTarget,
                  pendingOverdue: agent.pendingOverdue,
                  progressPct: agent.progressPct,
                },
                message: msg,
                timestamp: new Date().toISOString(),
              }),
            });
            channelDetails = `Payload HTTP POST entregado a ${effectiveConfig.webhookUrl}`;
          } catch (e: any) {
            status = 'failed';
            channelDetails = `Error al entregar webhook: ${e.message}`;
          }
        }

        const logEntry = {
          id: 'dsp_' + Math.random().toString(36).substring(2, 9),
          timestamp: new Date().toLocaleTimeString(),
          agentName: agent.name || `${agent.firstName} ${agent.lastName || ''}`.trim(),
          agentEmail: agent.email || 'asesor@crm.com',
          channel,
          status,
          messageSnippet: msg,
          triggerSource: triggerSource || 'on_demand',
          details: channelDetails,
        };
        newLogs.push(logEntry);
      }
    }

    notificationDispatchLogs = [...newLogs, ...notificationDispatchLogs.slice(0, 50)];
    currentNotificationConfig.lastDispatchedAt = new Date().toLocaleTimeString();

    res.json({
      success: true,
      dispatchedCount: newLogs.length,
      logs: newLogs,
      lastDispatchedAt: currentNotificationConfig.lastDispatchedAt,
    });
  });

  // Get Dispatch Logs
  app.get('/api/notifications/logs', (req: Request, res: Response) => {
    res.json({ success: true, logs: notificationDispatchLogs });
  });

  // --- HubSpot CRM Automated Excel (.xlsx) Report Generator & Email Dispatch Endpoints ---
  const generatedExcelReports = new Map<
    string,
    { fileName: string; buffer: Buffer; generatedAt: string; ownerName: string }
  >();
  let reportGenerationLogs: any[] = [];

  const DEMO_FALLBACK_OWNERS: HubSpotReportOwner[] = [];

  const DEMO_FALLBACK_CONTACTS: any[] = [];

  // POST /api/reports/generate-excel
  app.post('/api/reports/generate-excel', async (req: Request, res: Response) => {
    const token = await getHubSpotToken(req);
    const {
      ownerId,
      generateForAll,
      sendEmail,
      campaign,
      filterField,
      filterValue,
      dateRange,
      startDate,
      endDate,
      customSmtp,
      reportConfig,
    } = req.body || {};

    try {
      console.log(`[Report API] Iniciando generación de reporte Excel... OwnerId: ${ownerId || 'ALL'}, All: ${Boolean(generateForAll)}, Email: ${Boolean(sendEmail)}, CustomProps: ${reportConfig?.selectedProperties?.length || 'default'}`);

      const execution = await executeHubSpotReportGeneration(
        token,
        {
          ownerId,
          generateForAll: Boolean(generateForAll),
          sendEmail: Boolean(sendEmail),
          campaign: filterValue || campaign,
          filterField,
          filterValue,
          dateRange,
          startDate,
          endDate,
          customSmtp,
          reportConfig,
        },
        [],
        [],
      );

      // Save generated buffers in memory for direct download
      for (const rep of execution.results) {
        if (rep.excelBase64) {
          const buffer = Buffer.from(rep.excelBase64, 'base64');
          generatedExcelReports.set(rep.reportId, {
            fileName: rep.fileName,
            buffer,
            generatedAt: rep.generatedAt,
            ownerName: rep.ownerName,
          });
          generatedExcelReports.set(rep.fileName, {
            fileName: rep.fileName,
            buffer,
            generatedAt: rep.generatedAt,
            ownerName: rep.ownerName,
          });
        }

        // Add to historical logs
        reportGenerationLogs.unshift({
          id: rep.reportId,
          timestamp: new Date().toLocaleTimeString(),
          ownerId: rep.ownerId,
          ownerName: rep.ownerName,
          ownerEmail: rep.ownerEmail,
          fileName: rep.fileName,
          totalContacts: rep.totalContacts,
          fileSizeBytes: rep.fileSizeBytes,
          emailSent: rep.emailSent,
          emailStatus: rep.emailStatus,
          emailMessage: rep.emailMessage,
          downloadUrl: `/api/reports/download/${rep.reportId}`,
        });
      }

      // Trim logs
      reportGenerationLogs = reportGenerationLogs.slice(0, 100);

      return res.json({
        success: execution.success,
        summary: execution.summary,
        count: execution.results.length,
        reports: execution.results.map((r) => ({
          reportId: r.reportId,
          ownerId: r.ownerId,
          ownerName: r.ownerName,
          ownerEmail: r.ownerEmail,
          fileName: r.fileName,
          fileSizeBytes: r.fileSizeBytes,
          totalContacts: r.totalContacts,
          periodName: r.periodName,
          generatedAt: r.generatedAt,
          emailSent: r.emailSent,
          emailStatus: r.emailStatus,
          emailMessage: r.emailMessage,
          matrixSummary: r.matrixSummary,
          downloadUrl: `/api/reports/download/${r.reportId}`,
          excelBase64: r.excelBase64, // Provided so frontend can trigger instant browser download if desired
          contacts: r.contacts,
        })),
      });
    } catch (err: any) {
      console.error('[Report API Error]', err.message);
      return res.status(500).json({
        success: false,
        error: `Error al generar reporte Excel CRM: ${err.message}`,
      });
    }
  });

  // GET /api/reports/download/:idOrFileName
  app.get('/api/reports/download/:idOrFileName', (req: Request, res: Response) => {
    const { idOrFileName } = req.params;
    const item = generatedExcelReports.get(idOrFileName);

    if (!item) {
      return res.status(404).json({
        success: false,
        error: `Reporte no encontrado o expirado en el servidor: ${idOrFileName}`,
      });
    }

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${item.fileName}"`);
    res.setHeader('Content-Length', item.buffer.length);
    return res.end(item.buffer);
  });

  // GET /api/reports/logs
  app.get('/api/reports/logs', (req: Request, res: Response) => {
    res.json({ success: true, logs: reportGenerationLogs });
  });

  // GET /api/reports/filter-options
  app.get('/api/reports/filter-options', async (req: Request, res: Response) => {
    const token = await getHubSpotToken(req);

    // Baseline fallback options
    const baseOptions: Record<string, string[]> = {
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
    };

    // Extract from fallback contacts
    for (const c of DEMO_FALLBACK_CONTACTS) {
      if (c.utm_campaign && !baseOptions.campana.includes(c.utm_campaign)) baseOptions.campana.push(c.utm_campaign);
      if (c.carrera_de_interes && !baseOptions.carrera_de_interes.includes(c.carrera_de_interes)) baseOptions.carrera_de_interes.push(c.carrera_de_interes);
      if (c.FUENTE && !baseOptions.fuente.includes(c.FUENTE)) baseOptions.fuente.push(c.FUENTE);
      if (c.lifecyclestage && !baseOptions.lifecyclestage.includes(c.lifecyclestage)) baseOptions.lifecyclestage.push(c.lifecyclestage);
      if (c.hs_lead_status && !baseOptions.hs_lead_status.includes(c.hs_lead_status)) baseOptions.hs_lead_status.push(c.hs_lead_status);
    }

    if (token) {
      try {
        const resp = await fetch('https://api.hubapi.com/crm/v3/objects/contacts/search', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            properties: ['campana', 'utm_campaign', 'carrera_de_interes', 'carrera', 'fuente', 'FUENTE', 'lifecyclestage', 'hs_lead_status', 'city'],
            limit: 100,
          }),
        });

        if (resp.ok) {
          const data = await resp.json();
          for (const item of data.results || []) {
            const p = item.properties || {};
            const camp = p.campana || p.utm_campaign;
            if (camp && !baseOptions.campana.includes(camp)) baseOptions.campana.push(camp);
            const carr = p.carrera_de_interes || p.carrera;
            if (carr && !baseOptions.carrera_de_interes.includes(carr)) baseOptions.carrera_de_interes.push(carr);
            const fue = p.fuente || p.FUENTE;
            if (fue && !baseOptions.fuente.includes(fue)) baseOptions.fuente.push(fue);
            const city = p.city;
            if (city && !baseOptions.city.includes(city)) baseOptions.city.push(city);
          }
        }
      } catch (err: any) {
        console.warn('[Filter Options API] Warning querying HubSpot:', err.message);
      }
    }

    return res.json({
      success: true,
      options: baseOptions,
    });
  });

  // Global error handler for /api routes (ensures all API errors return clean JSON, never HTML)
  app.use('/api', (err: any, req: Request, res: Response, next: any) => {
    console.error('[API Error Handler]', err);
    if (res.headersSent) {
      return next(err);
    }
    const status = err.status || (err.name === 'PayloadTooLargeError' ? 413 : 500);
    return res.status(status).json({
      success: false,
      error: err.message || 'Error interno en el servidor',
    });
  });

  // Ensure that ANY route starting with /api that did not match returns JSON 404, NEVER HTML!
  app.all('/api/*', (req: Request, res: Response) => {
    return res.status(404).json({
      success: false,
      error: `Ruta de API no encontrada: ${req.method} ${req.originalUrl}`,
    });
  });

  // Determine if running in production mode
  const distPath = path.join(process.cwd(), 'dist');
  const isProduction =
    process.env.NODE_ENV === 'production' ||
    process.argv.includes('--production') ||
    (typeof __filename !== 'undefined' && __filename.endsWith('.cjs')) ||
    (fs.existsSync(path.join(distPath, 'index.html')) && !process.env.VITE_DEV_MODE);

  if (isProduction) {
    app.use(express.static(distPath));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    // Development mode with Vite middleware
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR === 'true' ? false : undefined,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`HubOps Suite de Promptia.lat Server running on port ${PORT}`);
  });
}

startServer();
