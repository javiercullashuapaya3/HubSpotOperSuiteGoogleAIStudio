import React, { useState } from 'react';
import {
  Lock,
  Mail,
  ShieldCheck,
  AlertCircle,
  Loader2,
  ArrowRight,
  Sun,
  Moon,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { PromptiaLogo } from './PromptiaLogo';

export const LoginScreen: React.FC = () => {
  const { handleLogin, isLoggingIn, loginError } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="min-h-screen bg-[#F0F0F0] dark:bg-[#020829] text-[#041050] dark:text-white flex items-center justify-center p-4 sm:p-6 lg:p-8 font-sans relative overflow-hidden transition-colors duration-200">
      {/* Subtle Brand Book ambient geometric glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 -right-40 w-96 h-96 rounded-full bg-[#00CFA7]/12 dark:bg-[#00CFA7]/15 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-40 -left-40 w-96 h-96 rounded-full bg-[#041050]/10 dark:bg-[#0B2287]/35 blur-3xl"
      />

      {/* Theme Switcher */}
      <button
        type="button"
        onClick={toggleTheme}
        className="absolute top-5 right-5 z-20 inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white dark:bg-[#06155E] border border-[#DCE1EB] dark:border-[#1B2F8A] text-[#041050] dark:text-white text-xs font-semibold shadow-xs hover:border-[#00CFA7] transition-colors cursor-pointer"
        aria-label={theme === 'light' ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro'}
      >
        {theme === 'light' ? (
          <>
            <Moon className="w-3.5 h-3.5 text-[#041050]" />
            <span>Modo Oscuro</span>
          </>
        ) : (
          <>
            <Sun className="w-3.5 h-3.5 text-[#00CFA7]" />
            <span>Modo Claro</span>
          </>
        )}
      </button>

      <div className="max-w-md w-full relative z-10">
        {/* Brand Banner */}
        <div className="text-center mb-8 flex flex-col items-center">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-white dark:bg-[#06155E] p-3 mb-4 border border-[#DCE1EB] dark:border-[#1B2F8A] shadow-md">
            <PromptiaLogo variant="icon" size={54} />
          </div>
          <div className="flex items-baseline justify-center">
            <span className="text-3xl font-black text-[#007F66] dark:text-[#00CFA7] tracking-tight">
              Promptia
            </span>
            <span className="text-3xl font-black text-[#041050] dark:text-white tracking-tight">
              .lat
            </span>
          </div>
          <h1 className="text-lg font-bold text-[#041050] dark:text-white mt-1">
            HubOps Suite
          </h1>
          <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5 font-medium">
            Operaciones Comerciales &amp; Gestión Masiva HubSpot CRM
          </p>
        </div>

        {/* Login Card */}
        <div className="bg-white dark:bg-[#041050] rounded-2xl shadow-lg border border-[#DCE1EB] dark:border-[#1B2F8A] p-6 sm:p-8 text-[#041050] dark:text-white">
          <div className="flex items-center justify-between pb-4 mb-6 border-b border-[#DCE1EB] dark:border-[#1B2F8A]">
            <div>
              <h2 className="text-base font-bold text-[#041050] dark:text-white">Iniciar Sesión</h2>
              <p className="text-xs text-slate-600 dark:text-slate-300">
                Ingresa tus credenciales de acceso
              </p>
            </div>
            <span className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-[#E6FAF5] dark:bg-[#00CFA7]/15 text-[#007F66] dark:text-[#00CFA7] border border-[#00CFA7]/40 flex items-center gap-1 whitespace-nowrap shrink-0">
              <ShieldCheck className="w-3.5 h-3.5 text-[#007F66] dark:text-[#00CFA7]" />
              Acceso Seguro
            </span>
          </div>

          {/* Error Message Alert */}
          {loginError && (
            <div
              className="mb-5 p-3.5 rounded-lg bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-700 text-rose-700 dark:text-rose-200 text-xs font-medium flex items-start gap-2.5"
              role="alert"
            >
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400 mt-0.5" />
              <div>
                <p className="font-semibold text-rose-800 dark:text-rose-100">
                  No pudimos iniciar tu sesión
                </p>
                <p className="mt-0.5">{loginError}</p>
              </div>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label
                htmlFor="email-input"
                className="block text-xs font-semibold text-[#041050] dark:text-slate-200 tracking-wide mb-1.5"
              >
                Correo Electrónico
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500 dark:text-slate-400">
                  <Mail className="w-4 h-4" />
                </div>
                <input
                  id="email-input"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="ejemplo@tuempresa.com"
                  className="w-full pl-9 pr-3 py-2.5 bg-[#F7F8FC] dark:bg-[#020829] border border-[#CBD5E1] dark:border-[#1E3599] rounded-lg text-sm text-[#041050] dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-400 focus:bg-white dark:focus:bg-[#06155E] focus:outline-none focus:ring-2 focus:ring-[#00CFA7] focus:border-transparent transition-all font-medium"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label
                  htmlFor="password-input"
                  className="block text-xs font-semibold text-[#041050] dark:text-slate-200 tracking-wide"
                >
                  Contraseña
                </label>
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="text-[11px] text-[#007F66] dark:text-[#00CFA7] hover:underline font-semibold cursor-pointer"
                >
                  {showPassword ? 'Ocultar' : 'Mostrar'}
                </button>
              </div>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500 dark:text-slate-400">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  id="password-input"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  placeholder="••••••••••••"
                  className="w-full pl-9 pr-3 py-2.5 bg-[#F7F8FC] dark:bg-[#020829] border border-[#CBD5E1] dark:border-[#1E3599] rounded-lg text-sm text-[#041050] dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-400 focus:bg-white dark:focus:bg-[#06155E] focus:outline-none focus:ring-2 focus:ring-[#00CFA7] focus:border-transparent transition-all font-medium"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoggingIn}
              className="w-full mt-2 py-3 px-4 bg-[#041050] hover:bg-[#081C7A] active:bg-[#020829] text-white dark:bg-[#00CFA7] dark:hover:bg-[#00B894] dark:text-[#041050] rounded-lg font-bold text-sm shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isLoggingIn ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Iniciando sesión...</span>
                </>
              ) : (
                <>
                  <span>Ingresar</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        </div>

        {/* Client Footer */}
        <div className="mt-6 text-center text-xs text-slate-600 dark:text-slate-300 flex items-center justify-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-[#007F66] dark:text-[#00CFA7]" />
          <span>Conexión cifrada y segura</span>
        </div>
      </div>
    </div>
  );
};
