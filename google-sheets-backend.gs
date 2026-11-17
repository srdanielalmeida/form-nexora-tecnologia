/**
 * ============================================================================
 * NEXORA TECNOLOGIA — BACKEND EM CÓDIGO PURO (GOOGLE APPS SCRIPT)
 * Planilha vinculada: https://docs.google.com/spreadsheets/d/11Bh-ju8Ma06N-gPWCaiyWifg17ceiRQFBzloguBn4-w/edit
 * ============================================================================
 *
 * O QUE ESTE CÓDIGO FAZ (100% SEU, SEM N8N OU FERRAMENTAS INTERMEDIÁRIAS):
 * 1. Recebe os dados do formulário (index.html) e grava/atualiza automaticamente na sua planilha.
 * 2. Cria automaticamente o cabeçalho formatado e o menu suspenso de Status Comercial na planilha.
 * 3. Sincroniza o contato com o Chatwoot (quando configurado).
 * 4. Envia os eventos de conversão reais (Lead, QualifiedLead e Purchase) para a Meta Conversions API (CAPI)
 *    com hash SHA-256 e deduplicação (event_id), tanto quando você muda o status na planilha quanto via Webhook do Chatwoot.
 */

const CONFIG = {
  SPREADSHEET_ID: '11Bh-ju8Ma06N-gPWCaiyWifg17ceiRQFBzloguBn4-w',
  SHEET_NAME: 'Leads',

  // Meta Pixel & Conversions API (CAPI)
  META_PIXEL_ID: '1518701493022426',
  META_ACCESS_TOKEN: '', // Cole aqui o Token de Acesso da API de Conversões gerado no Gerenciador de Eventos da Meta
  META_API_VERSION: 'v20.0',

  // Chatwoot (Opcional - preencha se quiser criar o contato automaticamente no Chatwoot)
  CHATWOOT_BASE_URL: '', // Ex: 'https://chat.nexoratecnologia.com'
  CHATWOOT_ACCOUNT_ID: '', // Ex: '1'
  CHATWOOT_API_TOKEN: '', // Seu User Access Token do Chatwoot
  CHATWOOT_INBOX_ID: '' // ID da caixa de entrada do WhatsApp no Chatwoot (opcional)
};

const HEADERS = [
  'lead_id',              // Coluna 1 (A)
  'data_hora',            // Coluna 2 (B)
  'status_qualificacao',  // Coluna 3 (C) -> qualified | special_case | not_qualified
  'status_comercial',     // Coluna 4 (D) -> Novo | Em atendimento | Qualificado | Proposta enviada | Cliente | Perdido
  'valor_venda',          // Coluna 5 (E) -> Valor do contrato em R$ (usado no evento Purchase)
  'nome',                 // Coluna 6 (F)
  'whatsapp',             // Coluna 7 (G)
  'whatsapp_e164',        // Coluna 8 (H)
  'email',                // Coluna 9 (I)
  'tipo_negocio',         // Coluna 10 (J)
  'experiencia_anuncios', // Coluna 11 (K)
  'investimento_mensal',  // Coluna 12 (L)
  'faturamento_mensal',   // Coluna 13 (M)
  'clicou_whatsapp',      // Coluna 14 (N)
  'origem',               // Coluna 15 (O)
  'utm_source',           // Coluna 16 (P)
  'utm_medium',           // Coluna 17 (Q)
  'utm_campaign',         // Coluna 18 (R)
  'utm_content',          // Coluna 19 (S)
  'utm_term',             // Coluna 20 (T)
  'fbclid',               // Coluna 21 (U)
  'fbp',                  // Coluna 22 (V)
  'fbc',                  // Coluna 23 (W)
  'event_source_url',     // Coluna 24 (X)
  'user_agent',           // Coluna 25 (Y)
  'chatwoot_contact_id',  // Coluna 26 (Z)
  'ultimo_evento_capi'    // Coluna 27 (AA)
];

/**
 * Garante que a aba "Leads" e os cabeçalhos existam na sua planilha.
 * Você também pode rodar esta função manualmente pelo botão "Executar" no Apps Script para criar a estrutura na hora.
 */
function setupPlanilha() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  let sheet = ss.getSheetByName(CONFIG.SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_NAME);
  }

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.setFrozenRows(1);

    const headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
    headerRange.setBackground('#0891b2');
    headerRange.setFontColor('#ffffff');
    headerRange.setFontWeight('bold');
  }

  return sheet;
}

/**
 * Endpoint HTTP POST que recebe os dados do index.html e/ou Webhooks do Chatwoot
 */
function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.tryLock(10000);

  try {
    const sheet = setupPlanilha();
    const rawBody = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
    const data = JSON.parse(rawBody);

    // 1. Verifica se é um Webhook vindo do Chatwoot (ex: conversa iniciada ou etiqueta alterada)
    if (data.event && (data.event === 'message_created' || data.event === 'conversation_updated')) {
      handleChatwootWebhook(sheet, data);
      return jsonResponse({ ok: true, source: 'chatwoot_webhook' });
    }

    // 2. Fluxo padrão vindo do formulário (index.html)
    const eventType = data.event_type || 'QuizCompleted';
    const attribution = data.attribution || {};
    const contact = data.contact || {};
    const qualification = data.qualification || {};
    const leadId = attribution.lead_id || ('nx-' + new Date().getTime());

    const existingRow = findRowByColumnValue(sheet, 1, leadId);

    if (eventType === 'WhatsAppClick' && existingRow > 0) {
      // Atualiza apenas a coluna clicou_whatsapp para "Sim"
      sheet.getRange(existingRow, 14).setValue('Sim');
      return jsonResponse({ ok: true, action: 'updated_whatsapp_click', lead_id: leadId });
    }

    // Sincroniza contato com Chatwoot (se configurado)
    let chatwootContactId = '';
    if (CONFIG.CHATWOOT_BASE_URL && CONFIG.CHATWOOT_API_TOKEN && contact.whatsapp_e164) {
      chatwootContactId = syncContactToChatwoot(contact, qualification, attribution, leadId);
    }

    const rowValues = [
      leadId,
      data.timestamp || new Date().toISOString(),
      qualification.status || '',
      'Novo',
      '', // valor_venda
      contact.name || '',
      contact.whatsapp || '',
      contact.whatsapp_e164 || '',
      contact.email || '',
      qualification.tipo_negocio || '',
      qualification.experiencia_anuncios || '',
      qualification.investimento_mensal || '',
      qualification.faturamento_mensal || '',
      eventType === 'WhatsAppClick' ? 'Sim' : 'Não',
      data.origin || '',
      attribution.utm_source || '',
      attribution.utm_medium || '',
      attribution.utm_campaign || '',
      attribution.utm_content || '',
      attribution.utm_term || '',
      attribution.fbclid || '',
      attribution.fbp || '',
      attribution.fbc || '',
      attribution.event_source_url || '',
      attribution.user_agent || '',
      chatwootContactId || '',
      ''
    ];

    if (existingRow > 0) {
      sheet.getRange(existingRow, 1, 1, rowValues.length).setValues([rowValues]);
      applyStatusDropdown(sheet, existingRow);
    } else {
      sheet.appendRow(rowValues);
      applyStatusDropdown(sheet, sheet.getLastRow());
    }

    return jsonResponse({ ok: true, lead_id: leadId });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Gatilho automático ao editar a planilha:
 * Quando você muda a coluna D (status_comercial) para:
 * - "Em atendimento" -> Envia evento "Lead" para a Meta CAPI
 * - "Qualificado"    -> Envia evento "QualifiedLead" para a Meta CAPI
 * - "Cliente"        -> Envia evento "Purchase" (com o valor da coluna E) para a Meta CAPI
 */
function onEdit(e) {
  if (!e || !e.range) return;
  const sheet = e.range.getSheet();
  if (sheet.getName() !== CONFIG.SHEET_NAME) return;

  const row = e.range.getRow();
  const col = e.range.getColumn();

  // Coluna 4 = status_comercial
  if (row > 1 && col === 4) {
    const newStatus = String(e.range.getValue() || '').trim();
    triggerCapiFromRowStatus(sheet, row, newStatus);
  }
}

function triggerCapiFromRowStatus(sheet, row, statusComercial) {
  const rowData = sheet.getRange(row, 1, 1, HEADERS.length).getValues()[0];
  const lead = mapRowToObject(rowData);

  if (statusComercial === 'Em atendimento') {
    const res = sendMetaCapiEvent('Lead', lead, null);
    if (res) sheet.getRange(row, 27).setValue('Lead (' + new Date().toLocaleString('pt-BR') + ')');
  } else if (statusComercial === 'Qualificado') {
    const res = sendMetaCapiEvent('QualifiedLead', lead, null);
    if (res) sheet.getRange(row, 27).setValue('QualifiedLead (' + new Date().toLocaleString('pt-BR') + ')');
  } else if (statusComercial === 'Cliente') {
    const rawVal = String(lead.valor_venda || '2000').replace(/[^\d.,]/g, '').replace(',', '.');
    const numericVal = parseFloat(rawVal) || 2000;
    const res = sendMetaCapiEvent('Purchase', lead, numericVal);
    if (res) sheet.getRange(row, 27).setValue('Purchase R$ ' + numericVal + ' (' + new Date().toLocaleString('pt-BR') + ')');
  }
}

/**
 * Envia evento para a Meta Conversions API (CAPI) com hash SHA-256 nos dados de contato
 */
function sendMetaCapiEvent(eventName, lead, purchaseValue) {
  if (!CONFIG.META_ACCESS_TOKEN) {
    return false;
  }

  const eventTime = Math.floor(new Date().getTime() / 1000);
  const eventId = lead.lead_id + '_' + eventName;

  const userData = {};
  if (lead.whatsapp_e164) {
    const cleanPhone = String(lead.whatsapp_e164).replace(/\D/g, '');
    if (cleanPhone) userData.ph = [sha256Hash(cleanPhone)];
  }
  if (lead.email) {
    const cleanEmail = String(lead.email).trim().toLowerCase();
    if (cleanEmail) userData.em = [sha256Hash(cleanEmail)];
  }
  if (lead.nome) {
    const firstName = String(lead.nome).trim().toLowerCase().split(/\s+/)[0];
    if (firstName) userData.fn = [sha256Hash(firstName)];
  }
  if (lead.fbp) userData.fbp = lead.fbp;
  if (lead.fbc) userData.fbc = lead.fbc;
  if (lead.user_agent) userData.client_user_agent = lead.user_agent;
  if (lead.lead_id) userData.external_id = [sha256Hash(String(lead.lead_id))];

  const eventPayload = {
    event_name: eventName,
    event_time: eventTime,
    event_id: eventId,
    action_source: 'website',
    event_source_url: lead.event_source_url || 'https://nexoratecnologia.com/',
    user_data: userData
  };

  if (eventName === 'Purchase' && purchaseValue) {
    eventPayload.custom_data = {
      currency: 'BRL',
      value: purchaseValue
    };
  }

  const url = 'https://graph.facebook.com/' + CONFIG.META_API_VERSION + '/' + CONFIG.META_PIXEL_ID + '/events?access_token=' + encodeURIComponent(CONFIG.META_ACCESS_TOKEN);

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ data: [eventPayload] }),
    muteHttpExceptions: true
  });

  return response.getResponseCode() >= 200 && response.getResponseCode() < 300;
}

/**
 * Cria ou atualiza o contato diretamente no Chatwoot com todas as respostas do formulário
 */
function syncContactToChatwoot(contact, qualification, attribution, leadId) {
  try {
    const baseUrl = CONFIG.CHATWOOT_BASE_URL.replace(/\/$/, '');
    const url = baseUrl + '/api/v1/accounts/' + CONFIG.CHATWOOT_ACCOUNT_ID + '/contacts';

    const payload = {
      name: contact.name || 'Lead Nexora',
      phone_number: contact.whatsapp_e164,
      custom_attributes: {
        lead_id: leadId,
        status_qualificacao: qualification.status || '',
        tipo_negocio: qualification.tipo_negocio || '',
        experiencia_anuncios: qualification.experiencia_anuncios || '',
        investimento_mensal: qualification.investimento_mensal || '',
        faturamento_mensal: qualification.faturamento_mensal || '',
        utm_source: attribution.utm_source || '',
        utm_campaign: attribution.utm_campaign || '',
        utm_content: attribution.utm_content || ''
      }
    };

    if (contact.email) payload.email = contact.email;
    if (CONFIG.CHATWOOT_INBOX_ID) payload.inbox_id = Number(CONFIG.CHATWOOT_INBOX_ID);

    const res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { api_access_token: CONFIG.CHATWOOT_API_TOKEN },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    const parsed = JSON.parse(res.getContentText() || '{}');
    if (parsed && parsed.payload && parsed.payload.contact && parsed.payload.contact.id) {
      return String(parsed.payload.contact.id);
    }
  } catch (e) {
    // Falha silenciosa para nunca interromper o salvamento na planilha
  }
  return '';
}

/**
 * Processa Webhooks vindos do Chatwoot (quando o cliente manda a 1ª mensagem ou recebe etiqueta)
 */
function handleChatwootWebhook(sheet, data) {
  const senderPhone = (data.sender && data.sender.phone_number) ||
    (data.meta && data.meta.sender && data.meta.sender.phone_number) || '';
  if (!senderPhone) return;

  const row = findRowByPhone(sheet, senderPhone);
  if (row <= 0) return;

  const currentStatus = String(sheet.getRange(row, 4).getValue() || '');

  // Se o cliente enviou mensagem no WhatsApp e o status ainda era "Novo", muda para "Em atendimento" e dispara Lead na CAPI
  if (data.event === 'message_created' && data.message_type === 'incoming' && currentStatus === 'Novo') {
    sheet.getRange(row, 4).setValue('Em atendimento');
    triggerCapiFromRowStatus(sheet, row, 'Em atendimento');
  }

  // Se as etiquetas da conversa mudaram no Chatwoot
  const labels = data.labels || (data.conversation && data.conversation.labels) || [];
  if (Array.isArray(labels)) {
    if (labels.indexOf('cliente') !== -1 && currentStatus !== 'Cliente') {
      sheet.getRange(row, 4).setValue('Cliente');
      triggerCapiFromRowStatus(sheet, row, 'Cliente');
    } else if (labels.indexOf('qualificado') !== -1 && currentStatus !== 'Qualificado' && currentStatus !== 'Cliente') {
      sheet.getRange(row, 4).setValue('Qualificado');
      triggerCapiFromRowStatus(sheet, row, 'Qualificado');
    }
  }
}

/**
 * Utilitários internos
 */
function applyStatusDropdown(sheet, row) {
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['Novo', 'Em atendimento', 'Qualificado', 'Proposta enviada', 'Cliente', 'Perdido'], true)
    .setAllowInvalid(true)
    .build();
  sheet.getRange(row, 4).setDataValidation(rule);
}

function findRowByColumnValue(sheet, colIndex, value) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  const values = sheet.getRange(2, colIndex, lastRow - 1, 1).getValues();
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][0]).trim() === String(value).trim()) {
      return i + 2;
    }
  }
  return -1;
}

function findRowByPhone(sheet, phone) {
  const cleanTarget = String(phone).replace(/\D/g, '').slice(-8);
  if (!cleanTarget) return -1;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  const values = sheet.getRange(2, 8, lastRow - 1, 1).getValues();
  for (let i = 0; i < values.length; i++) {
    const rowPhone = String(values[i][0]).replace(/\D/g, '').slice(-8);
    if (rowPhone && rowPhone === cleanTarget) {
      return i + 2;
    }
  }
  return -1;
}

function mapRowToObject(rowValues) {
  const obj = {};
  for (let i = 0; i < HEADERS.length; i++) {
    obj[HEADERS[i]] = rowValues[i];
  }
  return obj;
}

function sha256Hash(value) {
  const rawHash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8);
  return rawHash.map(function (b) {
    const v = (b < 0) ? 256 + b : b;
    return ('0' + v.toString(16)).slice(-2);
  }).join('');
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
