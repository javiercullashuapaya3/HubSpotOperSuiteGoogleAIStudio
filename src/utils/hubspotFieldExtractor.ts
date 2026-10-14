export function extractFieldValue(contact: any, fieldName: string): string {
  if (!fieldName || !contact) return '';
  let val = contact[fieldName];
  if (val === undefined || val === null || val === '') {
    // Check known aliases
    const lowerField = fieldName.toLowerCase().trim();
    if (lowerField === 'fuente' || lowerField === 'canal' || lowerField === 'lead_source' || lowerField === 'utm_source') {
      val = contact.fuente || contact.canal || contact.utm_source || contact.lead_source || contact.origen || contact.FUENTE || contact.hs_analytics_source;
    } else if (fieldName === 'lifecyclestage') {
      val = contact.lifecyclestage;
    } else if (fieldName === 'hs_lead_status') {
      val = contact.hs_lead_status;
    } else if (fieldName === 'campana' || fieldName === 'utm_campaign') {
      val = contact.campana || contact.utm_campaign;
    } else if (fieldName === 'carrera_de_interes' || fieldName === 'carrera') {
      val = contact.carrera_de_interes || contact.carrera;
    } else if (fieldName === 'hubspot_owner_id') {
      val = contact.hubspot_owner_id || contact.ownerId || contact.owner_id;
    } else if (fieldName === 'owner_name') {
      val = contact.owner_name || contact.owner;
    } else if (fieldName === 'hs_object_id' || fieldName === 'id') {
      val = contact.id || contact.hs_object_id;
    } else if (fieldName === 'whatsapp_phone_number') {
      val = contact.whatsapp_phone_number || contact.phone;
    } else if (fieldName === 'notes_last_updated') {
      val = contact.notes_last_updated;
    } else if (fieldName === 'createdate') {
      val = contact.createdate;
    } else if (fieldName === 'fecha_de_matricula') {
      val = contact.fecha_de_matricula;
    }
  }
  if (val === undefined || val === null || val === '') return '';
  if (typeof val === 'boolean') return val ? 'Sí' : 'No';
  if (typeof val === 'number') return String(val);
  return String(val).trim();
}
