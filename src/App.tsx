import React, { useState, useEffect } from 'react';
import {
  BarChart3,
  Settings,
  ShieldCheck,
  Zap,
  Database,
  Loader2,
  Sun,
  Moon,
} from 'lucide-react';
import { BulkLeadManager } from './components/BulkLeadManager';
import { AgentDailyMonitor } from './components/AgentDailyMonitor';
import { McpConfigPanel } from './components/McpConfigPanel';
import { LoginScreen } from './components/LoginScreen';
import { TenantHeaderBadge } from './components/TenantHeaderBadge';
import { PromptiaLogo } from './components/PromptiaLogo';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import { HubSpotOwner } from './types';
import { mcpHubspot } from './services/mcpHubspot';

function AppContent() {
  const { session, loading, company } = useAuth();
  const { theme, toggleTheme } = useTheme();
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
      if (e.detail === 'bulk' || e.detail === 'monitor' || e.detail === 'scheduler' || e.detail === 'config') {
        setActiveTab(e.detail === 'scheduler' ? 'monitor' : e.detail);
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
      <div className="min-h-screen bg-[#F4F7FA] dark:bg-[#0B0F19] flex flex-col items-center justify-center p-4 transition-colors">
        <div className="w-12 h-12 rounded-2xl bg-[#0B0F19] dark:bg-[#21B6EA] flex items-center justify-center text-white dark:text-[#0B0F19] mb-4 shadow-md">
          <Zap className="w-6 h-6" />
        </div>
        <div className="flex items-center gap-2 text-[#0B0F19] dark:text-white font-semibold text-sm">
          <Loader2 className="w-4 h-4 animate-spin text-[#0369A1] dark:text-[#21B6EA]" />
          <span>Iniciando sesión...</span>
        </div>
      </div>
    );
  }

  if (!session) {
    return <LoginScreen />;
  }

  return (
    <div className="min-h-screen bg-[#F4F7FA] dark:bg-[#0B0F19] text-[#1E293B] dark:text-slate-100 flex flex-col font-sans selection:bg-[#21B6EA]/30 selection:text-[#0B0F19] dark:selection:text-white transition-colors duration-200">
      {/* Executive Top Navbar */}
      <header
        className="sticky top-0 z-40 bg-white dark:bg-[#1E293B] border-b border-[#E2E8F0] dark:border-[#334155] shadow-2xs transition-colors"
        id="app-executive-header"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16 gap-4">
            {/* Logo & Brand Identity */}
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-[#F8FAFC] dark:bg-[#0B0F19] border border-[#E2E8F0] dark:border-[#334155] flex items-center justify-center p-1.5 shrink-0">
                <PromptiaLogo variant="icon" size={28} />
              </div>
              <div className="min-w-0">
                <h1 className="text-base font-extrabold text-[#0B0F19] dark:text-white tracking-tight flex items-baseline truncate">
                  <span className="text-[#0369A1] dark:text-[#21B6EA] font-black mr-0.5">Promptia</span>
                  <span className="text-[#0B0F19] dark:text-white font-black mr-1.5">.lat</span>
                  <span className="text-[#1E293B] dark:text-slate-200 font-bold">HubOps Suite</span>
                </h1>
                <p className="text-[11px] text-slate-600 dark:text-slate-300 font-medium truncate">
                  Operaciones Comerciales &amp; Gestión Masiva HubSpot CRM
                </p>
              </div>
            </div>

            {/* Right section: Conexión HubSpot + Theme Toggle + Perfil Tenant */}
            <div className="flex items-center gap-2 sm:gap-3 text-xs shrink-0">
              <button
                onClick={() => setActiveTab('config')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  isRealConnected
                    ? 'bg-[#E8F7FD] dark:bg-[#21B6EA]/15 text-[#0369A1] dark:text-[#21B6EA] border-[#21B6EA]/50 hover:bg-[#D5EFFA] dark:hover:bg-[#21B6EA]/25'
                    : 'bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-200 border-amber-300 dark:border-amber-700 hover:bg-amber-100'
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    isRealConnected ? 'bg-[#21B6EA]' : 'bg-amber-500'
                  }`}
                />
                <span>{isRealConnected ? 'HubSpot Conectado' : 'Conectar HubSpot'}</span>
              </button>

              <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#F8FAFC] dark:bg-[#0F172A] border border-[#E2E8F0] dark:border-[#334155] whitespace-nowrap">
                <span className="text-slate-600 dark:text-slate-300 font-medium">
                  API Oficial: <strong className="text-[#0B0F19] dark:text-white">HubSpot CRM v3</strong>
                </span>
                <span className="text-slate-300 dark:text-slate-600">|</span>
                <span className="text-[#0369A1] dark:text-[#21B6EA] font-semibold flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5" /> Sincronización Segura
                </span>
              </div>

              {/* Light / Dark Mode Switch */}
              <button
                type="button"
                onClick={toggleTheme}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[#E2E8F0] dark:border-[#334155] bg-[#F8FAFC] dark:bg-[#0F172A] text-[#0B0F19] dark:text-white hover:border-[#21B6EA] transition-colors cursor-pointer whitespace-nowrap shrink-0"
                title={theme === 'light' ? 'Activar modo oscuro' : 'Activar modo claro'}
                aria-label={theme === 'light' ? 'Activar modo oscuro' : 'Activar modo claro'}
              >
                {theme === 'light' ? (
                  <>
                    <Moon className="w-3.5 h-3.5 text-[#0B0F19]" />
                    <span className="hidden xl:inline font-semibold">Oscuro</span>
                  </>
                ) : (
                  <>
                    <Sun className="w-3.5 h-3.5 text-[#21B6EA]" />
                    <span className="hidden xl:inline font-semibold">Claro</span>
                  </>
                )}
              </button>

              {/* Supabase Authenticated Tenant Profile */}
              <TenantHeaderBadge onOpenConfig={() => setActiveTab('config')} />
            </div>
          </div>

          {/* Navigation Tabs */}
          <nav className="flex space-x-1 border-t border-[#E2E8F0] dark:border-[#334155] pt-1 overflow-x-auto" aria-label="Tabs">
            <button
              onClick={() => setActiveTab('bulk')}
              className={`py-3 px-4 text-xs font-semibold rounded-t-lg transition-all flex items-center gap-2 border-b-2 cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === 'bulk'
                  ? 'border-[#0B0F19] dark:border-[#21B6EA] text-[#0B0F19] dark:text-[#21B6EA] bg-[#EBF8FD] dark:bg-[#0F172A]'
                  : 'border-transparent text-slate-600 dark:text-slate-300 hover:text-[#0B0F19] dark:hover:text-white hover:border-slate-300 dark:hover:border-slate-500'
              }`}
            >
              <Zap className="w-4 h-4 text-[#0369A1] dark:text-[#21B6EA]" />
              <span>Gestión Masiva de Leads</span>
            </button>

            <button
              onClick={() => setActiveTab('monitor')}
              className={`py-3 px-4 text-xs font-semibold rounded-t-lg transition-all flex items-center gap-2 border-b-2 cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === 'monitor'
                  ? 'border-[#0B0F19] dark:border-[#21B6EA] text-[#0B0F19] dark:text-[#21B6EA] bg-[#EBF8FD] dark:bg-[#0F172A]'
                  : 'border-transparent text-slate-600 dark:text-slate-300 hover:text-[#0B0F19] dark:hover:text-white hover:border-slate-300 dark:hover:border-slate-500'
              }`}
            >
              <BarChart3 className="w-4 h-4 text-[#0369A1] dark:text-[#21B6EA]" />
              <span>Control y Despacho Operativo</span>
            </button>

            <button
              onClick={() => setActiveTab('config')}
              className={`py-3 px-4 text-xs font-semibold rounded-t-lg transition-all flex items-center gap-2 border-b-2 cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === 'config'
                  ? 'border-[#0B0F19] dark:border-[#21B6EA] text-[#0B0F19] dark:text-[#21B6EA] bg-[#EBF8FD] dark:bg-[#0F172A]'
                  : 'border-transparent text-slate-600 dark:text-slate-300 hover:text-[#0B0F19] dark:hover:text-white hover:border-slate-300 dark:hover:border-slate-500'
              }`}
            >
              <Settings className="w-4 h-4 text-[#1E293B] dark:text-slate-300" />
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
      <footer className="bg-white dark:bg-[#1E293B] border-t border-[#E2E8F0] dark:border-[#334155] py-4 text-xs text-slate-600 dark:text-slate-300 mt-auto transition-colors">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <PromptiaLogo variant="icon" size={16} />
            <span className="font-semibold text-[#0B0F19] dark:text-white">Promptia.lat HubOps Suite</span>
            <span aria-hidden="true">·</span>
            <span>Tu lógica opera sola, el valor se multiplica</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums text-[11px] text-slate-500 dark:text-slate-400">
              Última sync: {lastSync}
            </span>
          </div>

          <div className="flex items-center gap-4">
            <span className="text-slate-600 dark:text-slate-300 flex items-center gap-1">
              <Database className="w-3.5 h-3.5 text-[#0369A1] dark:text-[#21B6EA]" />
              HubSpot API v3 Ready
            </span>
            <span className="text-slate-600 dark:text-slate-300 flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-[#0369A1] dark:text-[#21B6EA]" />
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
    <ThemeProvider>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </ThemeProvider>
  );
}
