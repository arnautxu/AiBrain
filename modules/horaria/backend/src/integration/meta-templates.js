// Read-only provider evidence. Never return credentials, paging URLs or raw errors.
export async function readMetaTemplates() {
  const id = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
  const token = process.env.WHATSAPP_TOKEN;
  if (!/^\d+$/.test(id || '') || !token) throw new Error('Falta la configuració per verificar les plantilles a Meta.');
  const response = await fetch(`https://graph.facebook.com/v23.0/${id}/message_templates?fields=name,status,language,components&limit=100`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`No s’han pogut verificar les plantilles a Meta (${response.status}).`);
  const text = await response.text();
  if (text.length > 1024 * 1024) throw new Error('Resposta de plantilles massa gran.');
  const data = JSON.parse(text);
  if (!Array.isArray(data.data) || data.data.length > 100 || data.paging?.next) throw new Error('El catàleg de plantilles no es pot verificar completament.');
  return data.data.map(template => {
    const body = template.components?.find(c => c.type === 'BODY');
    const parameters = [...String(body?.text || '').matchAll(/\{\{(\d+)\}\}/g)].map(m => Number(m[1]));
    const count = parameters.length ? Math.max(...parameters) : 0;
    if (count > 50 || new Set(parameters).size !== count) throw new Error('Variables de plantilla no admeses.');
    return { name: template.name, language: template.language, status: template.status,
      bodyParameters: count, headerFormat: template.components?.find(c => c.type === 'HEADER')?.format || null };
  });
}

export function requireApprovedTemplate(templates, name, language, counts, documentHeader = false) {
  const template = templates.find(t => t.name === name && t.language === language);
  if (!template || template.status !== 'APPROVED') throw new Error(`La plantilla ${name} (${language}) encara no està aprovada. No s’ha enviat cap missatge.`);
  if (!counts.includes(template.bodyParameters) || (documentHeader && template.headerFormat !== 'DOCUMENT')) {
    throw new Error(`Els camps de la plantilla ${name} no coincideixen amb aquest enviament${documentHeader ? ': necessita capçalera DOCUMENT' : ''}. No s’ha enviat cap missatge.`);
  }
  return template;
}

export function selectedRecipients(where, employeeIds) {
  if (employeeIds === undefined) return where;
  if (!Array.isArray(employeeIds) || !employeeIds.length || employeeIds.length > 100 ||
      employeeIds.some(id => !Number.isSafeInteger(id) || id < 1) || new Set(employeeIds).size !== employeeIds.length) throw new Error('Selecció de destinataris no vàlida.');
  return { AND: [where, { id: { in: employeeIds } }] };
}
export function verifySelectedRecipients(employees, employeeIds) {
  if (employeeIds !== undefined && (employees.length !== employeeIds.length || employeeIds.some(id => !employees.some(e => e.id === id)))) {
    throw new Error('La selecció inclou persones no actives o sense telèfon d’aquesta botiga. No s’ha enviat cap missatge.');
  }
}
