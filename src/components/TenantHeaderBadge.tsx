import React, { useState } from 'react';
import {
  Building2,
  User,
  LogOut,
  ChevronDown,
  Key,
  ChevronRight,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { PromptiaLogo } from './PromptiaLogo';

interface TenantHeaderBadgeProps {
  onOpenConfig?: () => void;
}

export const TenantHeaderBadge: React.FC<TenantHeaderBadgeProps> = ({ onOpenConfig }) => {
  const { user, userName, company, handleLogout } = useAuth();
  const [isOpen, setIsOpen] = useState(false);

  if (!user) return null;

  const displayName = userName || user.email?.split('@')[0] || 'Usuario';
  const companyName = company?.name || 'Cargando empresa...';

  const handleOpenHubSpotConfig = () => {
    setIsOpen(false);
    if (onOpenConfig) {
      onOpenConfig();
    } else {
      window.dispatchEvent(new CustomEvent('switch-to-tab', { detail: 'config' }));
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition-colors shadow-2xs cursor-pointer"
        id="tenant-profile-button"
      >
        {/* Company Logo or Fallback Avatar */}
        {company?.logo ? (
          <img
            src={company.logo}
            alt={companyName}
            referrerPolicy="no-referrer"
            className="w-7 h-7 rounded-lg object-contain border border-slate-100 bg-slate-50"
            onError={(e) => {
              (e.target as HTMLElement).style.display = 'none';
            }}
          />
        ) : (
          <div className="w-7 h-7 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-center p-0.5 shrink-0">
            <PromptiaLogo variant="icon" size={20} />
          </div>
        )}

        <div className="text-left hidden sm:block">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-bold text-slate-800 leading-tight max-w-[150px] truncate">
              {companyName}
            </span>
          </div>
          <p className="text-[11px] text-slate-500 leading-tight max-w-[150px] truncate">
            {displayName}
          </p>
        </div>

        <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute right-0 mt-2 w-72 rounded-xl bg-white border border-slate-200 shadow-xl z-50 p-3.5 text-xs text-slate-700 space-y-3">
            {/* Header info */}
            <div className="pb-2.5 border-b border-slate-100">
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                Cuenta de Usuario
              </span>
              <p className="font-bold text-slate-900 text-sm mt-0.5">{displayName}</p>
              <p className="text-slate-500 font-mono text-[11px] truncate">{user.email}</p>
            </div>

            {/* Tenant details */}
            <div className="bg-slate-50 rounded-lg p-2.5 border border-slate-100 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-slate-500 text-[11px]">Empresa activa:</span>
                <span className="font-bold text-slate-800 text-[11px]">{companyName}</span>
              </div>

              {/* Botón directo a Configuración de HubSpot */}
              <button
                type="button"
                onClick={handleOpenHubSpotConfig}
                className="w-full flex items-center justify-between p-2 rounded-lg bg-indigo-50 hover:bg-indigo-100 active:bg-indigo-200 text-indigo-700 font-semibold text-[11px] transition-colors cursor-pointer border border-indigo-200/70"
              >
                <span className="flex items-center gap-1.5">
                  <Key className="w-3.5 h-3.5 text-indigo-600" />
                  <span>Configurar Token de HubSpot</span>
                </span>
                <ChevronRight className="w-3.5 h-3.5 text-indigo-500" />
              </button>
            </div>

            {/* Logout button */}
            <button
              onClick={() => {
                setIsOpen(false);
                handleLogout();
              }}
              className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 font-semibold text-xs transition-colors cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Cerrar Sesión</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
};
