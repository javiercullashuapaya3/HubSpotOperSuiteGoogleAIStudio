import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  Users,
  BarChart3,
  Settings,
  ShieldCheck,
  Zap,
  Activity,
  ArrowUpRight,
  Database,
  Layers,
  HelpCircle,
  ExternalLink,
  Loader2,
} from 'lucide-react';
import { BulkLeadManager } from './components/BulkLeadManager';
import { AgentDailyMonitor } from './components/AgentDailyMonitor';
import { McpConfigPanel } from './components/McpConfigPanel';
import { LoginScreen } from './components/LoginScreen';
import { TenantHeaderBadge } from './components/TenantHeaderBadge';
import { PromptiaLogo } from './components/PromptiaLogo';
import { AuthProvider, useAuth } from './context/AuthContext';
import { HubSpotOwner } from './types';
import { mcpHubspot } from './services/mcpHubspot';

function AppContent() {
  const { session, loading, company } = useAuth();
  const [activeTab, setActiveTab] = useState<'bulk' | 'monitor' | 'config'>('bulk');
  const [owners, setOwners] = useState<HubSpotOwner[]>([]);
  const [lastSync, setLastSync] = useState<string>(new Date().toLocaleTimeString());
  const [isRealConnected, setIsRealConnected] = useState<boolean>(mcpHubspot.isConnectedToRealCRM());

  // Load owners and listen to status changes
  const refreshOwners = async () => {
    try {
      if (company) {
        mcpHubspot.setActiveCompany(company);
      }
      const data = await mcpHubspot.hubspot_get_owners();
      setOwners(data);
      setLastSync(new Date().toLocaleTimeString());
      setIsRealConnected(mcpHubspot.isConnectedToRealCRM());
    } catch (err) {
      console.warn('Advertencia al sincronizar asesores desde HubSpot CRM:', err);
    }
  };

  useEffect(() => {
    if (!session) return;

    if (company) {
      mcpHubspot.setActiveCompany(company);
    }
    refreshOwners();

    const unsub = mcpHubspot.subscribeStatus((st) => {
      setIsRealConnected(st.isReal);
      setLastSync(new Date().toLocaleTimeString());
    });

    const handleTabSwitch = (e: any) => {
      if (e.detail === 'bulk' || e.detail === 'monitor' || e.detail === 'config') {
        setActiveTab(e.detail);
      }
    };
    window.addEventListener('switch-to-tab', handleTabSwitch);

    return () => {
      unsub();
      window.removeEventListener('switch-to-tab', handleTabSwitch);
    };
  }, [session, company?.client_id, company?.hubspot_token]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4">
        <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center text-white mb-4 animate-pulse">
          <Zap className="w-6 h-6 fill-white text-white" />
        </div>
        <div className="flex items-center gap-2 text-white font-semibold text-sm">
          <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
          <span>Iniciando sesión...</span>
        </div>
      </div>
    );
  }

  if (!session) {
    return <LoginScreen />;
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800 flex flex-col font-sans selection:bg-indigo-100 selection:text-indigo-900">
      {/* Executive Top Navbar */}
      <header className="sticky top-0 z-40 bg-white border-b border-slate-200 shadow-xs" id="app-executive-header">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo & Brand Identity */}
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-white border border-slate-200 shadow-2xs flex items-center justify-center p-1.5 hover:border-indigo-300 transition-colors shrink-0">
                <PromptiaLogo variant="icon" size={32} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-base font-extrabold text-slate-900 tracking-tight flex items-baseline">
                    <span className="text-[#00C4FF] font-black mr-0.5">Promptia</span>
                    <span className="text-[#9333EA] font-black mr-1.5">.lat</span>
                    <span className="text-slate-800 font-extrabold">HubOps Suite</span>
                  </h1>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 tracking-wide uppercase">
                    v2.4
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 font-medium">
                  Operaciones Comerciales &amp; Gestión Masiva HubSpot CRM
                </p>
              </div>
            </div>

            {/* Right section: Conexión HubSpot + Perfil Tenant */}
            <div className="flex items-center gap-2 sm:gap-3 text-xs">
              <button
                onClick={() => setActiveTab('config')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                  isRealConnected
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100'
                    : 'bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100'
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${isRealConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
                <span>{isRealConnected ? 'HubSpot Conectado' : 'Conectar HubSpot'}</span>
              </button>

              <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200">
                <span className="text-slate-600 font-medium">
                  API Oficial: <strong className="text-slate-900">HubSpot CRM v3</strong>
                </span>
                <span className="text-slate-300">|</span>
                <span className="text-emerald-700 font-semibold flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5" /> Sincronización Segura
                </span>
              </div>

              {/* Supabase Authenticated Tenant Profile */}
              <TenantHeaderBadge onOpenConfig={() => setActiveTab('config')} />
            </div>
          </div>

          {/* Navigation Tabs */}
          <nav className="flex space-x-1 border-t border-slate-100 pt-1" aria-label="Tabs">
            <button
              onClick={() => setActiveTab('bulk')}
              className={`py-3 px-4 text-xs font-semibold rounded-t-lg transition-all flex items-center gap-2 border-b-2 cursor-pointer ${
                activeTab === 'bulk'
                  ? 'border-indigo-600 text-indigo-700 bg-indigo-50/40'
                  : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
              }`}
            >
              <Zap className="w-4 h-4 text-indigo-600" />
              <span>Gestión Masiva de Leads</span>
            </button>

            <button
              onClick={() => setActiveTab('monitor')}
              className={`py-3 px-4 text-xs font-semibold rounded-t-lg transition-all flex items-center gap-2 border-b-2 cursor-pointer ${
                activeTab === 'monitor'
                  ? 'border-indigo-600 text-indigo-700 bg-indigo-50/40'
                  : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
              }`}
            >
              <BarChart3 className="w-4 h-4 text-emerald-600" />
              <span>Control y Despacho Operativo</span>
            </button>

            <button
              onClick={() => setActiveTab('config')}
              className={`py-3 px-4 text-xs font-semibold rounded-t-lg transition-all flex items-center gap-2 border-b-2 cursor-pointer ${
                activeTab === 'config'
                  ? 'border-indigo-600 text-indigo-700 bg-indigo-50/40'
                  : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
              }`}
            >
              <Settings className="w-4 h-4 text-slate-600" />
              <span>Configuración del Sistema</span>
            </button>
          </nav>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {activeTab === 'bulk' && (
          <BulkLeadManager owners={owners} onDataModified={refreshOwners} />
        )}

        {activeTab === 'monitor' && <AgentDailyMonitor owners={owners} />}

        {activeTab === 'config' && <McpConfigPanel onTokenSynced={refreshOwners} />}
      </main>

      {/* Operational Footer */}
      <footer className="bg-white border-t border-slate-200 py-4 text-xs text-slate-500 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <PromptiaLogo variant="icon" size={16} />
            <span className="font-semibold text-slate-800">Promptia.lat HubOps Suite</span>
            <span>•</span>
            <span>Sincronizado con HubSpot CRM</span>
            <span>•</span>
            <span className="font-mono text-[11px] text-slate-400">Última sync: {lastSync}</span>
          </div>

          <div className="flex items-center gap-4">
            <span className="text-slate-400 flex items-center gap-1">
              <Database className="w-3.5 h-3.5 text-slate-500" />
              HubSpot API v3 Ready
            </span>
            <span className="text-slate-400 flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              Supabase Multi-Tenant Auth
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
