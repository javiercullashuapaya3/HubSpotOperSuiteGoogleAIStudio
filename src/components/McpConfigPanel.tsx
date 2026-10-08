import React, { useState, useEffect } from 'react';
import {
  Settings,
  Key,
  Terminal,
  Activity,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  RefreshCw,
  Server,
  Layers,
  Code2,
  FileText,
  Play,
  ShieldCheck,
  Zap,
  Trash2,
  CheckCircle,
  ExternalLink,
  Building2,
} from 'lucide-react';
import { McpConnectionState, McpToolLog } from '../types';
import { mcpHubspot } from '../services/mcpHubspot';
import { useAuth } from '../context/AuthContext';
import { PromptiaLogo } from './PromptiaLogo';

interface McpConfigPanelProps {
  onTokenSynced?: () => void;
}

export const McpConfigPanel: React.FC<McpConfigPanelProps> = ({ onTokenSynced }) => {
  const { company, updateCompanyHubspotToken } = useAuth();
  const [connState, setConnState] = useState<McpConnectionState>(mcpHubspot.getConnectionState());
  const [tokenInput, setTokenInput] = useState<string>(
    company?.hubspot_token || connState.privateAppToken || ''
  );
  const [activeSubTab, setActiveSubTab] = useState<'connection' | 'telemetry' | 'python_export'>('connection');
  const [logs, setLogs] = useState<McpToolLog[]>([]);
  const [copiedSection, setCopiedSection] = useState<string | null>(null);

  // Sync / Verification State
  const [isVerifying, setIsVerifying] = useState<boolean>(false);
  const [syncStatus, setSyncStatus] = useState<{
    type: 'success' | 'error' | 'idle';
    message: string;
    details?: string;
  }>({
    type: 'idle',
    message: '',
  });

  // Test Runner State
  const [testTool, setTestTool] = useState<string>('hubspot_get_owners');
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<any>(null);

  // Sincronizar tokenInput si la empresa cambia o se carga el token desde Supabase (tabla companies)
  useEffect(() => {
    if (company?.hubspot_token) {
      setTokenInput(company.hubspot_token);
    }
  }, [company?.hubspot_token]);

  useEffect(() => {
    const unsubscribeLogs = mcpHubspot.subscribeLogs((newLogs) => {
      setLogs(newLogs);
    });
    const unsubscribeStatus = mcpHubspot.subscribeStatus((st) => {
      if (st.isReal) {
        setSyncStatus({ type: 'success', message: st.message });
      } else if (st.error) {
        setSyncStatus({ type: 'error', message: st.message, details: st.error });
      }
    });

    return () => {
      unsubscribeLogs();
      unsubscribeStatus();
    };
  }, []);

  const handleSaveAndConnectToken = async () => {
    const cleanToken = tokenInput.trim();
    if (!cleanToken) {
      setSyncStatus({
        type: 'error',
        message: 'Por favor ingresa tu token antes de guardar.',
      });
      return;
    }

    setIsVerifying(true);
    setSyncStatus({ type: 'idle', message: '' });

    try {
      // 1. Verificar y sincronizar con HubSpot inmediatamente
      const syncResult = await mcpHubspot.verifyAndSyncWithHubspot(cleanToken);
      setConnState(mcpHubspot.getConnectionState());

      if (!syncResult.success) {
        setSyncStatus({
          type: 'error',
          message: syncResult.message || 'Error al conectar con HubSpot CRM.',
          details: syncResult.error,
        });
        return;
      }

      // 2. Intentar persistir en Supabase (si está configurado)
      try {
        await updateCompanyHubspotToken(cleanToken);
      } catch (err) {
        console.warn('Persistencia en Supabase opcional:', err);
      }

      setSyncStatus({
        type: 'success',
        message: `¡Conexión verificada exitosamente! Se sincronizaron ${syncResult.ownersCount || 0} asesores de tu HubSpot CRM.`,
      });

      if (onTokenSynced) {
        onTokenSynced();
      }
    } catch (err: any) {
      setSyncStatus({
        type: 'error',
        message: 'Error al verificar y guardar token con el servidor.',
        details: err.message,
      });
    } finally {
      setIsVerifying(false);
    }
  };

  const handleDisconnect = async () => {
    setTokenInput('');
    setIsVerifying(true);
    try {
      await updateCompanyHubspotToken('');
      setConnState(mcpHubspot.getConnectionState());
      setSyncStatus({
        type: 'idle',
        message: 'Token desconectado. Modo de prueba activo.',
      });
      if (onTokenSynced) {
        onTokenSynced();
      }
    } catch (err: any) {
      console.error('Error al remover token:', err);
    } finally {
      setIsVerifying(false);
    }
  };

  const handleRunToolTest = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      if (testTool === 'hubspot_get_owners') {
        const res = await mcpHubspot.hubspot_get_owners();
        setTestResult(res);
      } else if (testTool === 'hubspot_search_contacts') {
        const res = await mcpHubspot.hubspot_search_contacts({
          ownerId: 'ALL',
          leadStatus: 'ALL',
          lifecycleStage: 'ALL',
          campaign: 'ALL',
          searchKeyword: '',
        });
        setTestResult(res);
      } else if (testTool === 'hubspot_get_agent_metrics') {
        const res = await mcpHubspot.hubspot_get_agent_metrics();
        setTestResult(res);
      }
    } catch (err: any) {
      setTestResult({
        status: 'ERROR',
        error: err.message || 'Error al invocar tool',
      });
    } finally {
      setIsTesting(false);
    }
  };

  const copyToClipboard = (text: string, sectionId: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSection(sectionId);
    setTimeout(() => setCopiedSection(null), 2500);
  };

  const pythonStreamlitCode = `# app.py - HUB OPS SUITE (STREAMLIT + HUBSPOT CLIENT)
import asyncio
import json
import streamlit as st
import pandas as pd
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

st.set_page_config(
    page_title="HubOps Suite de Promptia.lat - HubSpot CRM",
    page_icon="⚡",
    layout="wide"
)

# 1. AUTENTICACIÓN Y CONEXIÓN CON HUBSPOT CRM
st.sidebar.title("⚡ HubOps Suite de Promptia.lat")
st.sidebar.caption("Operaciones Comerciales & Gestión Masiva de Leads")

token = st.sidebar.text_input(
    "HubSpot Private App Token (HUBSPOT_ACCESS_TOKEN):",
    type="password",
    help="Ingresa el token de aplicación privada generado en tu portal de HubSpot con scopes crm.objects.contacts.read y write."
)

if not token:
    st.info("👋 Ingresa tu Private App Token en la barra lateral para inicializar la conexión con tu portal de HubSpot.")
    st.stop()

# Helper asíncrono para invocar herramientas vía npx @axonops/hubspot-mcp
async def run_mcp_tool(tool_name: str, arguments: dict = {}):
    server_params = StdioServerParameters(
        command="npx",
        args=["-y", "@axonops/hubspot-mcp"],
        env={"HUBSPOT_ACCESS_TOKEN": token}
    )
    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            result = await session.call_tool(tool_name, arguments)
            return result

# 2. CARGA DINÁMICA DE METADATOS (OWNERS/ASESORES)
if "owners" not in st.session_state:
    with st.spinner("Cargando catálogo de asesores desde HubSpot CRM..."):
        try:
            owners_res = asyncio.run(run_mcp_tool("hubspot_get_owners"))
            st.session_state["owners"] = owners_res
        except Exception as e:
            st.error(f"Error al conectar con el servidor: {str(e)}")
            st.stop()

st.success("✓ Conexión activa y catálogo de asesores sincronizado.")
`;

  const isRealConnected = mcpHubspot.isConnectedToRealCRM();

  return (
    <div className="space-y-6" id="mcp-config-panel-container">
      {/* Header */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md bg-slate-100 text-slate-800 text-xs font-semibold uppercase tracking-wider mb-2">
            <Server className="w-3.5 h-3.5 text-indigo-600" />
            Pestaña 3: Protocolo &amp; Conectividad
          </div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">
            Configuración y Conexión de tu HubSpot CRM
          </h2>
          <p className="text-sm text-slate-600 mt-0.5">
            Ingresa tu Private App Token para conectar y sincronizar en vivo tu portal real de HubSpot CRM.
          </p>
        </div>

        {/* Sub Navigation */}
        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg border border-slate-200 text-xs font-semibold">
          <button
            onClick={() => setActiveSubTab('connection')}
            className={`px-3 py-1.5 rounded-md transition-colors cursor-pointer ${
              activeSubTab === 'connection'
                ? 'bg-white text-indigo-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Conexión &amp; Token
          </button>
          <button
            onClick={() => setActiveSubTab('telemetry')}
            className={`px-3 py-1.5 rounded-md transition-colors cursor-pointer ${
              activeSubTab === 'telemetry'
                ? 'bg-white text-indigo-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span>Registro de Actividad ({logs.length})</span>
          </button>
          <button
            onClick={() => setActiveSubTab('python_export')}
            className={`px-3 py-1.5 rounded-md transition-colors cursor-pointer ${
              activeSubTab === 'python_export'
                ? 'bg-white text-indigo-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Código Python (app.py)
          </button>
        </div>
      </div>

      {activeSubTab === 'connection' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Connection Parameters & Token Form (7 cols) */}
          <div className="lg:col-span-7 bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Key className="w-4 h-4 text-indigo-600" />
                <h3 className="text-sm font-semibold text-slate-900 uppercase tracking-wide">
                  Autenticación con tu HubSpot CRM
                </h3>
              </div>
              <span
                className={`text-xs font-semibold px-2.5 py-0.5 rounded-full flex items-center gap-1 border ${
                  isRealConnected
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-amber-50 text-amber-700 border-amber-200'
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${isRealConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
                {isRealConnected ? 'Conectado a HubSpot Real' : 'Modo Standalone / Prueba'}
              </span>
            </div>

            {/* Token Input Form */}
            <div>
              <div className="mb-3 p-3 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-900 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <PromptiaLogo variant="icon" size={20} />
                  <span>
                    Empresa: <strong>{company?.name || 'Promptia.lat'}</strong> (cliente_id: <code>{company?.client_id || company?.id || '1'}</code>)
                  </span>
                </div>
                <span className="text-[11px] font-medium text-indigo-700 bg-white px-2.5 py-0.5 rounded border border-indigo-200 shrink-0">
                  Campo BD: <code>companies.hubspot_token</code>
                </span>
              </div>

              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-semibold text-slate-800">
                  HubSpot Private App Token (`companies.hubspot_token`)
                </label>
                {company && (
                  <span className="text-[11px] text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-md font-medium flex items-center gap-1">
                    <Building2 className="w-3 h-3" />
                    Cliente: {company.name}
                  </span>
                )}
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="password"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  placeholder="pat-na1-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  className="flex-1 text-xs font-mono bg-slate-50 border border-slate-300 rounded-lg px-3 py-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-2xs"
                />
                <button
                  onClick={handleSaveAndConnectToken}
                  disabled={isVerifying || !tokenInput.trim()}
                  className="bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white text-xs font-semibold px-5 py-2.5 rounded-lg transition-all shadow-xs cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50 shrink-0"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isVerifying ? 'animate-spin' : ''}`} />
                  {isVerifying ? 'Guardando en BD...' : '🔑 Guardar Token en Tabla companies'}
                </button>
              </div>

              {tokenInput && (
                <div className="mt-2 flex justify-end">
                  <button
                    onClick={handleDisconnect}
                    className="text-[11px] text-slate-500 hover:text-rose-600 flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                    Quitar token de la empresa
                  </button>
                </div>
              )}
            </div>

            {/* Status Feedback Notice */}
            {syncStatus.type === 'success' && (
              <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-start gap-2.5 animate-in fade-in">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold text-emerald-900">¡Conexión Exitosa con tu HubSpot CRM!</div>
                  <p className="mt-0.5 text-emerald-700 leading-relaxed">{syncStatus.message}</p>
                </div>
              </div>
            )}

            {syncStatus.type === 'error' && (
              <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-start gap-2.5 animate-in fade-in">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold text-rose-900">Error al Conectar con HubSpot</div>
                  <p className="mt-0.5 text-rose-700">{syncStatus.message}</p>
                  {syncStatus.details && (
                    <div className="mt-1 font-mono text-[11px] bg-white/70 p-2 rounded border border-rose-200 text-rose-950 whitespace-pre-wrap">
                      {syncStatus.details}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Scopes Guide */}
            <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-2">
              <div className="font-semibold text-slate-800 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-indigo-600" />
                Permisos requeridos en tu aplicación privada de HubSpot:
              </div>
              <p className="text-slate-600 text-[11px] leading-relaxed">
                En tu portal de HubSpot ve a <strong>Configuración &gt; Integraciones &gt; Aplicaciones privadas</strong> y asegúrate de otorgar los siguientes scopes:
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 font-mono text-[10px]">
                <div className="bg-white p-2 rounded border border-slate-200">
                  <span className="text-indigo-600 font-bold block">crm.objects.contacts.read</span>
                  <span className="text-slate-500">Buscar contactos</span>
                </div>
                <div className="bg-white p-2 rounded border border-slate-200">
                  <span className="text-indigo-600 font-bold block">crm.objects.contacts.write</span>
                  <span className="text-slate-500">Actualizar masivo</span>
                </div>
                <div className="bg-white p-2 rounded border border-slate-200">
                  <span className="text-indigo-600 font-bold block">crm.objects.owners.read</span>
                  <span className="text-slate-500">Listar asesores</span>
                </div>
              </div>
            </div>
          </div>

          {/* Tool Tester & Inspector (5 cols) */}
          <div className="lg:col-span-5 bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-indigo-600" />
                <h3 className="text-sm font-semibold text-slate-900 uppercase tracking-wide">
                  Probador de Conexión en Vivo
                </h3>
              </div>
              <span className="text-[10px] text-slate-400 font-mono">HubSpot API</span>
            </div>

            <div className="flex gap-2">
              <select
                value={testTool}
                onChange={(e) => setTestTool(e.target.value)}
                className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-slate-800 font-mono"
              >
                <option value="hubspot_get_owners">tool: hubspot_get_owners</option>
                <option value="hubspot_search_contacts">tool: hubspot_search_contacts</option>
                <option value="hubspot_get_agent_metrics">tool: hubspot_get_agent_metrics</option>
              </select>
              <button
                onClick={handleRunToolTest}
                disabled={isTesting}
                className="bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white text-xs font-semibold px-4 py-2 rounded-lg flex items-center gap-1.5 shrink-0 cursor-pointer"
              >
                <Play className="w-3.5 h-3.5" />
                {isTesting ? 'Invocando...' : 'Ejecutar'}
              </button>
            </div>

            {/* Response Viewer */}
            <div className="bg-slate-950 rounded-xl p-3 font-mono text-[11px] text-slate-200 max-h-72 overflow-y-auto border border-slate-800">
              <div className="text-slate-500 border-b border-slate-800 pb-1.5 mb-2 flex justify-between">
                <span>RESPUESTA ({testTool})</span>
                <span className={testResult?.status === 'ERROR' ? 'text-rose-400 font-bold' : 'text-emerald-400'}>
                  {testResult ? (testResult?.status === 'ERROR' ? 'STATUS_500_ERROR' : 'STATUS_200_OK') : 'READY'}
                </span>
              </div>
              {testResult ? (
                <pre className={`${testResult?.status === 'ERROR' ? 'text-rose-300' : 'text-emerald-300'} whitespace-pre-wrap`}>
                  {JSON.stringify(testResult, null, 2)}
                </pre>
              ) : (
                <div className="text-slate-500 py-6 text-center italic">
                  Haz clic en "Ejecutar" para enviar una llamada JSON-RPC a la tool y visualizar la estructura de datos retornada de tu CRM.
                </div>
              )}
            </div>

            {/* VPS Deployment Helper Notice for Nginx/Node.js */}
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-slate-700 text-[11px] space-y-1.5">
              <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                <Server className="w-3.5 h-3.5 text-indigo-600" />
                <span>Configuración de Nginx en VPS (para evitar respuestas HTML 502/404):</span>
              </div>
              <p className="text-slate-600 leading-relaxed">
                Si tu VPS usa Nginx, agrega este bloque dentro de tu <code>server &#123; ... &#125;</code> para que Nginx no devuelva <code>index.html</code> en las rutas de API:
              </p>
              <pre className="bg-slate-900 text-indigo-200 p-2 rounded text-[10px] overflow-x-auto font-mono">
{`location /api/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}`}
              </pre>
              <p className="text-[10px] text-slate-500">
                Comando para iniciar Node en tu VPS: <code>npm run build &amp;&amp; npm start</code> (o <code>pm2 start dist/server.cjs --name hubops</code>).
              </p>
            </div>
          </div>
        </div>
      )}

      {activeSubTab === 'telemetry' && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
          <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-indigo-600" />
              <h3 className="text-sm font-semibold text-slate-900 uppercase tracking-wide">
                Registro de Actividad y Peticiones al CRM en Tiempo Real
              </h3>
            </div>
            <span className="text-xs text-slate-500">
              Mostrando las últimas {logs.length} peticiones
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
                  <th className="py-2.5 px-3">Hora</th>
                  <th className="py-2.5 px-3">Tool Invocada</th>
                  <th className="py-2.5 px-3">Estado</th>
                  <th className="py-2.5 px-3">Latencia</th>
                  <th className="py-2.5 px-3">Detalle / Respuesta</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                {(logs || []).map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-3 text-slate-500">{log.timestamp}</td>
                    <td className="py-2.5 px-3 text-indigo-700 font-semibold">{log.tool}</td>
                    <td className="py-2.5 px-3">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border ${
                          log.status === 'success'
                            ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                            : 'text-rose-700 bg-rose-50 border-rose-200'
                        }`}
                      >
                        {log.status === 'success' ? (
                          <CheckCircle2 className="w-3 h-3" />
                        ) : (
                          <AlertCircle className="w-3 h-3" />
                        )}
                        {log.status.toUpperCase()}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-slate-600">{log.latencyMs} ms</td>
                    <td className="py-2.5 px-3 text-slate-700 max-w-md truncate">
                      {log.responseSummary}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeSubTab === 'python_export' && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Code2 className="w-4 h-4 text-indigo-600" />
                <h3 className="text-sm font-semibold text-slate-900 uppercase tracking-wide">
                  Código Python Oficial (Streamlit + HubSpot API)
                </h3>
              </div>
              <button
                onClick={() => copyToClipboard(pythonStreamlitCode, 'pycode')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
              >
                {copiedSection === 'pycode' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5 text-slate-600" />}
                {copiedSection === 'pycode' ? '¡Copiado!' : 'Copiar app.py'}
              </button>
            </div>

            <p className="text-xs text-slate-600 mb-3">
              Este script implementa el flujo con <code className="text-indigo-600 font-mono font-bold">mcp.client.stdio.stdio_client</code> ejecutando <code className="text-indigo-600 font-mono font-bold">npx -y @axonops/hubspot-mcp</code> directamente en Python 3.10+.
            </p>

            <div className="bg-slate-950 text-slate-200 p-4 rounded-xl font-mono text-xs max-h-96 overflow-y-auto border border-slate-800">
              <pre className="whitespace-pre-wrap">{pythonStreamlitCode}</pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
