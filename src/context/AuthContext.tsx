import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '../supabase';
import { TenantCompany, HubSpotReportConfig, sanitizeReportConfig } from '../types';
import { mcpHubspot } from '../services/mcpHubspot';

interface AuthContextType {
  session: Session | null;
  user: User | null;
  userName: string;
  company: TenantCompany | null;
  loading: boolean;
  isLoggingIn: boolean;
  loginError: string | null;
  files: any[];
  handleLogin: (e: React.FormEvent<HTMLFormElement>) => Promise<void>;
  handleLogout: () => Promise<void>;
  fetchUserData: (user: any) => Promise<void>;
  updateCompanyHubspotToken: (newToken: string) => Promise<{ success: boolean; error?: string }>;
  updateCompanyReportConfig: (newConfig: HubSpotReportConfig) => Promise<{ success: boolean; error?: string }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [isLoggingIn, setIsLoggingIn] = useState<boolean>(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [userName, setUserName] = useState<string>('');
  const [company, setCompany] = useState<TenantCompany | null>(null);
  const [files, setFiles] = useState<any[]>([]);

  // Ref de empresa para evitar recrear callbacks en cada actualización de estado
  const companyRef = useRef<TenantCompany | null>(company);
  useEffect(() => {
    companyRef.current = company;
  }, [company]);

  // 4. RESOLUCIÓN DE EMPRESA Y METADATA DEL USUARIO (fetchUserData)
  const fetchUserData = async (user: any) => {
    try {
      // PASO 1: Buscar client_id en la metadata del token JWT
      let clientId =
        user.user_metadata?.client_id ||
        user.app_metadata?.client_id ||
        user.user_metadata?.clientId ||
        user.app_metadata?.clientId ||
        user.client_id;

      // PASO 2: Consultar tabla 'user_companies' para obtener el nombre del usuario y confirmar client_id
      const { data: ucData, error: ucError } = await supabase
        .from('user_companies')
        .select('name, client_id')
        .eq('user_id', user.id);

      if (ucData && ucData.length > 0) {
        setUserName(ucData[0].name);
        if (!clientId) clientId = ucData[0].client_id;
      }

      // PASO 3: Si aún no hay clientId, consultar tabla 'profiles'
      if (!clientId) {
        const { data: profileData } = await supabase
          .from('profiles')
          .select('client_id')
          .eq('id', user.id)
          .maybeSingle();

        if (profileData) clientId = profileData.client_id;
      }

      // PASO 4: Si no se detectó clientId en metadata ni en user_companies, usar 1 por defecto (Promptia.lat)
      if (!clientId) {
        clientId = 1;
      }

      // PASO 5: Consultar la tabla 'companies' usando el clientId resuelto
      const compIdNum = Number(clientId);
      let companyData: any = null;

      if (!isNaN(compIdNum)) {
        const { data } = await supabase
          .from('companies')
          .select('*')
          .eq('id', compIdNum)
          .maybeSingle();
        companyData = data;
      }

      if (!companyData) {
        const { data } = await supabase
          .from('companies')
          .select('*')
          .order('id', { ascending: true })
          .limit(1)
          .maybeSingle();
        companyData = data;
      }

      // PASO 6: Mapear y guardar la empresa en el estado global
      if (companyData) {
        const logoUrl =
          companyData.logo ||
          companyData.logo_url ||
          companyData.image ||
          companyData.avatar_url ||
          '';

        const tokenFromDb = companyData.hubspot_token || '';

        // Recuperar hubspot_report_config guardado en Supabase o fallback en localStorage
        let reportConfigFromDb = companyData.hubspot_report_config;
        if (typeof reportConfigFromDb === 'string') {
          try {
            reportConfigFromDb = JSON.parse(reportConfigFromDb);
          } catch (_) {}
        }
        if (!reportConfigFromDb && typeof window !== 'undefined') {
          try {
            const cachedConfig = localStorage.getItem(`hubspot_report_config_${clientId}`);
            if (cachedConfig) {
              reportConfigFromDb = JSON.parse(cachedConfig);
            }
          } catch (_) {}
        }

        const validConfig = sanitizeReportConfig(reportConfigFromDb);

        setCompany({
          id: companyData.id || '',
          client_id: clientId,
          name: companyData.name || 'Mi Empresa',
          logo: logoUrl,
          public_client_id: companyData.public_client_id,
          api_key: companyData.api_key, // Llave interna para webhooks (ej. n8n)
          hubspot_token: tokenFromDb,
          hubspot_report_config: validConfig,
        });

        // Extraer y sincronizar automáticamente el token de HubSpot si viene de la tabla companies
        if (tokenFromDb && tokenFromDb.trim().length > 0) {
          mcpHubspot.verifyAndSyncWithHubspot(tokenFromDb.trim());
        }
      } else {
        // Si no se encuentra registro específico en companies, establecer objeto fallback limpio
        let fallbackConfig: any = undefined;
        if (typeof window !== 'undefined') {
          try {
            const cached = localStorage.getItem(`hubspot_report_config_${clientId}`) || localStorage.getItem('hubspot_report_config_fallback');
            if (cached) fallbackConfig = JSON.parse(cached);
          } catch (_) {}
        }

        setCompany({
          id: String(clientId),
          client_id: clientId,
          name: 'Mi Empresa',
          logo: '',
          hubspot_report_config: sanitizeReportConfig(fallbackConfig),
        });
      }
    } catch (err: any) {
      console.error('Error en fetchUserData:', err);
    }
  };

  // Guardar y persistir la configuración de reporte de HubSpot en el campo json hubspot_report_config de companies
  const updateCompanyReportConfig = useCallback(
    async (
      newConfig: HubSpotReportConfig
    ): Promise<{ success: boolean; error?: string }> => {
      const enrichedConfig: HubSpotReportConfig = sanitizeReportConfig({
        ...newConfig,
        updatedAt: new Date().toISOString(),
      });

      const currentCompany = companyRef.current;

      // 1. Guardar de inmediato en localStorage para disponibilidad instantánea
      if (typeof window !== 'undefined') {
        const storageKey = currentCompany?.client_id
          ? `hubspot_report_config_${currentCompany.client_id}`
          : 'hubspot_report_config_fallback';
        try {
          localStorage.setItem(storageKey, JSON.stringify(enrichedConfig));
        } catch (_) {}
      }

      // 2. Actualizar estado local reactivo
      setCompany((prev) => (prev ? { ...prev, hubspot_report_config: enrichedConfig } : null));

      if (!currentCompany || !currentCompany.client_id) {
        return { success: true };
      }

      try {
        // 3. Persistir en la columna json hubspot_report_config de la tabla companies en Supabase
        let updateResult = await supabase
          .from('companies')
          .update({ hubspot_report_config: enrichedConfig })
          .eq('id', currentCompany.id || currentCompany.client_id);

        if (updateResult.error || (updateResult.count !== null && updateResult.count === 0)) {
          const retryResult = await supabase
            .from('companies')
            .update({ hubspot_report_config: enrichedConfig })
            .eq('client_id', currentCompany.client_id);

          if (retryResult.error) {
            console.warn('Advertencia al actualizar hubspot_report_config en companies:', retryResult.error.message);
            // Si la columna aún no existe o hay restricción RLS, la configuración permanece guardada localmente
            return { success: true, error: retryResult.error.message };
          } else {
            updateResult = retryResult;
          }
        }

        return { success: true };
      } catch (err: any) {
        console.error('Error al guardar hubspot_report_config en companies:', err);
        return { success: true, error: err.message };
      }
    },
    []
  );

  // Guardar y persistir el hubspot_token en la tabla companies para el cliente actual
  const updateCompanyHubspotToken = useCallback(
    async (newToken: string): Promise<{ success: boolean; error?: string }> => {
      const currentCompany = companyRef.current;
      const targetId = currentCompany?.id || currentCompany?.client_id || 1;
      const compIdNum = Number(targetId);
      const cleanToken = newToken.trim();

      try {
        let updateResult: any;
        if (!isNaN(compIdNum)) {
          updateResult = await supabase
            .from('companies')
            .update({ hubspot_token: cleanToken })
            .eq('id', compIdNum);
        } else {
          updateResult = await supabase
            .from('companies')
            .update({ hubspot_token: cleanToken })
            .eq('id', targetId);
        }

        if (updateResult.error) {
          console.error('Error al actualizar hubspot_token en companies:', updateResult.error);
          return { success: false, error: updateResult.error.message };
        }

        // Actualizar estado local
        setCompany((prev) => (prev ? { ...prev, hubspot_token: cleanToken } : null));

        // Sincronizar con el protocolo MCP
        await mcpHubspot.verifyAndSyncWithHubspot(cleanToken);

        return { success: true };
      } catch (err: any) {
        console.error('Error al guardar hubspot_token en companies:', err);
        return { success: false, error: err.message || 'Error al persistir en Supabase' };
      }
    },
    []
  );

  // 3. ESCUCHA ACTIVA DE SESIÓN (useEffect)
  useEffect(() => {
    let isMounted = true;

    // 1. Verificar sesión existente al cargar la página
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!isMounted) return;
      setSession(session);
      if (session) {
        fetchUserData(session.user);
      }
      setLoading(false);
    });

    // 2. Escuchar cambios de estado (LOGIN, LOGOUT, TOKEN_REFRESHED)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!isMounted) return;
      setSession(session);
      if (session) {
        fetchUserData(session.user);
      } else {
        // Limpiar estados al cerrar sesión
        setCompany(null);
        setUserName('');
        setFiles([]);
        mcpHubspot.verifyAndSyncWithHubspot('');
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // 2. CONTROLADOR DE LOGIN (SUBMIT FORM)
  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoginError(null);
    setIsLoggingIn(true);

    const formData = new FormData(e.currentTarget);
    const rawEmail = (formData.get('email') as string) || '';
    const email = rawEmail.trim().toLowerCase();
    const rawPassword = (formData.get('password') as string) || '';
    const password = rawPassword.trim();

    if (!email || !password) {
      setLoginError('Por favor ingresa tu correo y contraseña.');
      setIsLoggingIn(false);
      return;
    }

    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });

      if (error) {
        console.warn('Error al autenticar:', error.message);
        const msg = error.message.toLowerCase();
        if (
          msg.includes('invalid login credentials') ||
          msg.includes('invalid credentials') ||
          msg.includes('user not found')
        ) {
          setLoginError('Usuario o contraseña incorrectos. Por favor verifica tus datos.');
        } else if (msg.includes('email not confirmed')) {
          setLoginError('Tu correo electrónico aún no ha sido confirmado.');
        } else if (msg.includes('too many requests') || msg.includes('rate limit')) {
          setLoginError('Demasiados intentos. Por favor espera unos momentos e intenta de nuevo.');
        } else {
          setLoginError('No fue posible iniciar sesión. Por favor verifica tus credenciales.');
        }
        setIsLoggingIn(false);
      } else if (data?.user) {
        // En caso de éxito, el listener onAuthStateChange o fetchUserData se encargarán
        setIsLoggingIn(false);
      }
    } catch (err: any) {
      console.error('Error inesperado en login:', err);
      setLoginError('Error de conexión. Verifica tu conexión a internet o intenta nuevamente.');
      setIsLoggingIn(false);
    }
  };

  // 5. CERRAR SESIÓN (handleLogout)
  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user || null,
        userName,
        company,
        loading,
        isLoggingIn,
        loginError,
        files,
        handleLogin,
        handleLogout,
        fetchUserData,
        updateCompanyHubspotToken,
        updateCompanyReportConfig,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth debe ser utilizado dentro de un AuthProvider');
  }
  return context;
};
