"""
HubOps Suite - Actualizaciones Masivas en HubSpot CRM vía Model Context Protocol (MCP)
Desarrollado en Python 3.10+, Streamlit y el SDK oficial de MCP.
"""
import asyncio
import json
import os
import time
from typing import Any, Dict, List, Optional
import pandas as pd
import streamlit as st

try:
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client
    MCP_AVAILABLE = True
except ImportError:
    MCP_AVAILABLE = False

# Configuración inicial de la página
st.set_page_config(
    page_title="HubOps Suite - HubSpot MCP",
    page_icon="⚡",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ---------------------------------------------------------
# 1. AUTENTICACIÓN Y CONEXIÓN MCP EN LA BARRA LATERAL
# ---------------------------------------------------------
st.sidebar.markdown("## ⚡ HubOps Suite")
st.sidebar.markdown("**Gestión Masiva & Operaciones Comerciales**")
st.sidebar.markdown("---")

hubspot_token = st.sidebar.text_input(
    "HubSpot Private App Token:",
    type="password",
    value=os.environ.get("HUBSPOT_ACCESS_TOKEN", ""),
    help="Ingresa el token de aplicación privada con scopes de lectura y escritura para contactos y propietarios.",
)

server_mode = st.sidebar.selectbox(
    "Modo de Transporte MCP:",
    ["Stdio (@axonops/hubspot-mcp)", "Simulador Resiliente Standalone"],
    index=0 if MCP_AVAILABLE else 1,
)

st.sidebar.markdown("---")
st.sidebar.caption("Protocolo: Model Context Protocol (MCP stdio)")
st.sidebar.caption("Rate Limit Preventivo: 100ms / request")

# Función asíncrona para ejecutar tools del servidor MCP
async def call_mcp_tool_async(tool_name: str, arguments: Dict[str, Any], token: str) -> Any:
    if not MCP_AVAILABLE or "Simulador" in server_mode:
        # Si no hay token o servidor MCP activo, retornar vacío para requerir conexión real
        await asyncio.sleep(0.05)
        if tool_name == "hubspot_get_owners":
            return []
        elif tool_name == "hubspot_search_contacts":
            return []
        elif tool_name == "hubspot_update_contact":
            return {"status": "success", "contactId": arguments.get("contactId")}
        return []

    # Ejecución oficial con SDK de MCP vía StdioServerParameters
    server_params = StdioServerParameters(
        command="npx",
        args=["-y", "@axonops/hubspot-mcp"],
        env={"HUBSPOT_ACCESS_TOKEN": token},
    )
    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            result = await session.call_tool(tool_name, arguments)
            if hasattr(result, "content") and len(result.content) > 0:
                try:
                    return json.loads(result.content[0].text)
                except Exception:
                    return result.content[0].text
            return result

def run_tool_sync(tool_name: str, arguments: Dict[str, Any] = {}) -> Any:
    return asyncio.run(call_mcp_tool_async(tool_name, arguments, hubspot_token))

# Control de autenticación inicial
if not hubspot_token:
    st.info("👋 **Bienvenido a HubOps Suite.** Por favor ingresa tu **HubSpot Private App Token** en la barra lateral para inicializar el cliente MCP.")
    st.stop()

# ---------------------------------------------------------
# 2. CARGA DINÁMICA DE METADATOS (OWNERS / ASESORES)
# ---------------------------------------------------------
if "owners_catalog" not in st.session_state:
    with st.spinner("Conectando al servidor MCP y cargando asesores (hubspot_get_owners)..."):
        try:
            owners_raw = run_tool_sync("hubspot_get_owners")
            # Mapeo id -> Nombre legible
            owner_map = {}
            for o in owners_raw:
                owner_id = str(o.get("id"))
                full_name = f"{o.get('firstName', '')} {o.get('lastName', '')} ({o.get('email', '')})"
                owner_map[owner_id] = full_name
            st.session_state["owners_catalog"] = owner_map
            st.session_state["owners_raw"] = owners_raw
        except Exception as e:
            st.error(f"Error al inicializar sesión MCP: {str(e)}")
            st.stop()

owner_catalog = st.session_state.get("owners_catalog", {})

# ---------------------------------------------------------
# TÍTULO PRINCIPAL
# ---------------------------------------------------------
st.title("⚡ HubOps Suite — Gestión Masiva de Leads en HubSpot")
st.markdown("Plataforma ejecutiva de reasignación y actualización en lote conectada mediante el **Model Context Protocol (MCP)**.")

# ---------------------------------------------------------
# 3. FILTROS DE BÚQUEDA Y SEGMENTACIÓN (ORIGEN)
# ---------------------------------------------------------
st.subheader("1. Filtros de Búsqueda y Segmentación (Origen)")

col1, col2, col3 = st.columns(3)

with col1:
    lead_status_options = ["TODOS", "NEW", "OPEN", "IN_PROGRESS", "OPEN_DEAL", "UNQUALIFIED", "ATTEMPTED_TO_CONTACT", "CONNECTED", "BAD_TIMING"]
    selected_status = st.selectbox("Estado del Lead (`hs_lead_status`):", lead_status_options)

with col2:
    lifecycle_options = ["TODOS", "subscriber", "lead", "marketingqualifiedlead", "salesqualifiedlead", "opportunity", "customer", "other"]
    selected_lifecycle = st.selectbox("Etapa del Ciclo de Vida (`lifecyclestage`):", lifecycle_options)

with col3:
    owner_options = ["TODOS"] + list(owner_catalog.keys())
    selected_owner_id = st.selectbox(
        "Asesor / Propietario Actual:",
        options=owner_options,
        format_func=lambda x: "Todos los Asesores" if x == "TODOS" else owner_catalog.get(x, x),
    )

search_clicked = st.button("🔍 Buscar Leads en HubSpot CRM", type="primary", use_container_width=True)

if search_clicked or "contacts_result" not in st.session_state:
    with st.spinner("Consultando contactos mediante tool MCP hubspot_search_contacts..."):
        filter_args = {}
        if selected_status != "TODOS":
            filter_args["hs_lead_status"] = selected_status
        if selected_lifecycle != "TODOS":
            filter_args["lifecyclestage"] = selected_lifecycle
        if selected_owner_id != "TODOS":
            filter_args["hubspot_owner_id"] = selected_owner_id

        contacts = run_tool_sync("hubspot_search_contacts", filter_args)
        st.session_state["contacts_result"] = contacts

contacts = st.session_state.get("contacts_result", [])

# ---------------------------------------------------------
# 4. TABLA DE PREVISUALIZACIÓN (PREVIEW & SAFETY GUARD)
# ---------------------------------------------------------
st.markdown("---")
st.subheader("2. Previsualización de Resultados (Safety Guard)")

if not contacts:
    st.warning("No se encontraron leads con los criterios seleccionados.")
else:
    df = pd.DataFrame(contacts)
    # Reemplazar owner_id por nombre legible para la vista
    if "hubspot_owner_id" in df.columns:
        df["Asesor Actual"] = df["hubspot_owner_id"].apply(lambda oid: owner_catalog.get(str(oid), oid))

    st.markdown(f"**Total encontrado:** `{len(df)} leads` listos para evaluación.")
    st.dataframe(df, use_container_width=True)

    # ---------------------------------------------------------
    # 5. PANEL DE ACCIONES MASIVAS (DESTINO)
    # ---------------------------------------------------------
    st.markdown("---")
    st.subheader("3. Panel de Acciones Masivas (Destino)")

    act_col1, act_col2, act_col3, act_col4 = st.columns(4)

    with act_col1:
        new_owner_opts = ["-- Sin cambio --"] + list(owner_catalog.keys())
        target_owner = st.selectbox(
            "Reasignar Cartera a:",
            new_owner_opts,
            format_func=lambda x: "-- Sin cambio --" if x == "-- Sin cambio --" else owner_catalog.get(x, x),
        )

    with act_col2:
        target_status = st.selectbox(
            "Nuevo Estado del Lead:",
            ["-- Sin cambio --", "NEW", "OPEN", "IN_PROGRESS", "OPEN_DEAL", "UNQUALIFIED", "ATTEMPTED_TO_CONTACT", "CONNECTED"],
        )

    with act_col3:
        target_stage = st.selectbox(
            "Nueva Etapa de Ciclo:",
            ["-- Sin cambio --", "subscriber", "lead", "marketingqualifiedlead", "salesqualifiedlead", "opportunity", "customer"],
        )

    with act_col4:
        target_campaign = st.text_input(
            "Asignar/Sobreescribir Campaña:",
            placeholder="Dejar vacío para sin cambio",
        )

    # Construir diccionario de cambios
    updates_payload = {}
    if target_owner != "-- Sin cambio --":
        updates_payload["hubspot_owner_id"] = target_owner
    if target_status != "-- Sin cambio --":
        updates_payload["hs_lead_status"] = target_status
    if target_stage != "-- Sin cambio --":
        updates_payload["lifecyclestage"] = target_stage
    if target_campaign.strip():
        updates_payload["utm_campaign"] = target_campaign.strip()

    # ---------------------------------------------------------
    # 6. EJECUCIÓN Y RESILIENCIA EN LOTE (BATCH EXECUTION)
    # ---------------------------------------------------------
    if not updates_payload:
        st.info("💡 Configura al menos un valor de destino arriba para habilitar la actualización masiva.")
    else:
        st.warning(f"⚠️ **Confirmación de Seguridad:** Se actualizarán **{len(contacts)} leads** con los siguientes cambios:")
        st.json(updates_payload)

        if st.button(f"⚡ Ejecutar Actualización Masiva sobre {len(contacts)} leads", type="primary"):
            progress_bar = st.progress(0)
            status_text = st.empty()

            success_count = 0
            fail_count = 0
            total_leads = len(contacts)

            for i, lead in enumerate(contacts):
                contact_id = str(lead.get("id"))
                try:
                    # Invocar tool de actualización
                    run_tool_sync("hubspot_update_contact", {
                        "contactId": contact_id,
                        "properties": updates_payload
                    })
                    success_count += 1
                except Exception as err:
                    fail_count += 1

                # Rate limiting preventivo (100ms)
                time.sleep(0.1)

                # Actualizar barra de progreso
                progress_pct = int(((i + 1) / total_leads) * 100)
                progress_bar.progress(progress_pct)
                status_text.text(f"Procesando contacto {i+1} de {total_leads}... ({progress_pct}%)")

            status_text.empty()
            st.success(f"✓ ¡Lote finalizado! {success_count} leads actualizados correctamente. ({fail_count} errores)")
            st.balloons()
