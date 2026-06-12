import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outPath = process.argv[2] || path.join(here, "starlab-telegram-visual-native.workflow.json");

const nodes = [];
const add = (node) => nodes.push(node);

const targetUserFromPlatrumUsersJs = `
(() => {
  const users = $('Resolve Platrum Target User').item.json.data?.users || [];
  const text = (($('Extract Telegram Message').item.json.text || '') + ' ' + ($('Extract Telegram Message').item.json.argsText || '')).toLowerCase();
  return (users.find(u =>
    text.includes(String(u.displayName || '').toLowerCase()) ||
    text.includes(String(u.employeeId || '').toLowerCase()) ||
    (u.id === 'u-maksat' && (text.includes('РјР°РєСЃР°С‚') || text.includes('maksat'))) ||
    (u.id === 'u-pm-1' && (text.includes('Р±РµРіР°Р№') || text.includes('begay') || text.includes('begoim') || text.includes('pm1')))
  ) || users[0] || {}).id || 'u-maksat';
})()
`.trim();

const targetUserFromMetriconUsersJs = `
(() => {
  const users = $('Resolve Metricon Target User').item.json.data?.users || [];
  const text = (($('Extract Telegram Message').item.json.text || '') + ' ' + ($('Extract Telegram Message').item.json.argsText || '')).toLowerCase().replace(/ё/g, 'е');
  return (users.find(u =>
    text.includes(String(u.displayName || '').toLowerCase()) ||
    text.includes(String(u.employeeId || '').toLowerCase()) ||
    (u.id === 'u-maksat' && (text.includes('максат') || text.includes('maksat'))) ||
    (u.id === 'u-pm-1' && (text.includes('бегай') || text.includes('бегайым') || text.includes('begay') || text.includes('begoim') || text.includes('pm1')))
  ) || users[0] || {}).id || 'u-maksat';
})()
`.trim();

const targetUserFromAiUsersJs = `
(() => {
  const users = $('AI List Users').item.json.data?.users || [];
  const text = (($('Extract Telegram Message').item.json.text || '') + ' ' + ($('Extract Telegram Message').item.json.argsText || '')).toLowerCase();
  return (users.find(u =>
    text.includes(String(u.displayName || '').toLowerCase()) ||
    text.includes(String(u.employeeId || '').toLowerCase()) ||
    (u.id === 'u-maksat' && (text.includes('РјР°РєСЃР°С‚') || text.includes('maksat'))) ||
    (u.id === 'u-pm-1' && (text.includes('Р±РµРіР°Р№') || text.includes('begay') || text.includes('begoim') || text.includes('pm1')))
  ) || users[0] || {}).id || 'u-maksat';
})()
`.trim();

const metriconPeriodJs = `
(() => {
  const to = new Date();
  const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
})()
`.trim();

const googleSnapshotUrl = `={{
(() => {
  const users = $('AI List Users').item.json.data?.users || [];
  const text = $('Extract Telegram Message').item.json.text.toLowerCase();
  const target = users.find(u =>
    text.includes(String(u.displayName || '').toLowerCase()) ||
    text.includes(String(u.employeeId || '').toLowerCase()) ||
    (u.id === 'u-maksat' && (text.includes('РјР°РєСЃР°С‚') || text.includes('maksat'))) ||
    (u.id === 'u-pm-1' && (text.includes('Р±РµРіР°Р№') || text.includes('begay') || text.includes('begoim')))
  ) || users[0] || { id: 'u-maksat', displayName: 'Maksat', employeeId: 'maksat' };
  const name = target.displayName || '';
  const employee = target.employeeId || '';
  const terms = [
    name,
    employee,
    name + ' Р Р°Р±РѕС‚Р°',
    name + ' work',
    name + ' PM',
    employee + ' work',
    'СЂР°Р±РѕС‡РёР№ РіСЂР°С„РёРє',
    'СЂР°Р±РѕС‚Р°',
    'work',
    'PM'
  ].filter(Boolean).map(v => '&calendarSearchTerm=' + encodeURIComponent(v)).join('');
  return $env.CONTROL_PLANE_INTERNAL_URL +
    '/api/v1/google/workspace-snapshot?period=week' +
    '&calendarEvents=50&calendarList=200&sharedCalendarMatches=20&sharedCalendarEvents=50' +
    '&gmailMessages=25&driveFiles=25&documentFiles=8&docCharLimit=5000' +
    '&userId=' + encodeURIComponent(target.id) + terms;
})()
}}`;

const wantsVoiceReplyExpression = "={{ (() => { const text = String($json.body?.message?.text || $json.body?.message?.caption || $json.body?.edited_message?.text || '').toLowerCase(); return text.includes('голос') || text.includes('войс') || text.includes('аудио') || text.includes('voice') || text.includes('audio'); })() }}";
const routeVoiceReplyExpression = "={{ (() => { const msg = $('Extract Telegram Message').item.json; const text = String(msg.text || '').toLowerCase(); return String(Boolean(msg.isVoice || msg.voiceReplyRequested || text.includes('голос') || text.includes('войс') || text.includes('аудио') || text.includes('voice') || text.includes('audio'))); })() }}";

add(webhook("Telegram Webhook", "telegram-webhook", [0, 0]));
add(setNode("Extract Telegram Message", "extract-telegram", [280, 0], [
  field("chatId", "={{ $json.body?.message?.chat?.id || $json.body?.edited_message?.chat?.id || '' }}"),
  field("telegramUserId", "={{ String($json.body?.message?.from?.id || $json.body?.edited_message?.from?.id || '') }}"),
  field("text", "={{ String($json.body?.message?.text || $json.body?.message?.caption || $json.body?.edited_message?.text || '').trim() }}"),
  field("command", "={{ (String($json.body?.message?.text || $json.body?.edited_message?.text || '').trim().startsWith('/') ? String($json.body?.message?.text || $json.body?.edited_message?.text || '').trim().split(/\\s+/)[0].split('@')[0].toLowerCase() : '') }}"),
  field("argsText", "={{ (() => { const t = String($json.body?.message?.text || $json.body?.edited_message?.text || '').trim(); if (!t.startsWith('/')) return t; const first = t.split(/\\s+/)[0]; return t.slice(first.length).trim(); })() }}"),
  field("isVoice", "={{ Boolean($json.body?.message?.voice) }}", "boolean"),
  field("voiceFileId", "={{ $json.body?.message?.voice?.file_id || '' }}"),
  field("voiceMimeType", "={{ $json.body?.message?.voice?.mime_type || 'audio/ogg' }}"),
  field("voiceReplyRequested", wantsVoiceReplyExpression, "boolean"),
  field("receivedAt", "={{ $now.toISO() }}"),
]));

add(switchNode("Route Input Type", "route-input-type", [420, 0], [
  ["true", "Voice"],
], "={{ String($json.isVoice) }}", "Text"));

add(httpNode("Transcribe Telegram Voice", "transcribe-telegram-voice", [620, -220], "POST", "={{ $env.CONTROL_PLANE_INTERNAL_URL + '/api/v1/voice/transcribe-telegram' }}", "={{ { fileId: $('Extract Telegram Message').item.json.voiceFileId, mimeType: $('Extract Telegram Message').item.json.voiceMimeType } }}"));
add(setNode("Apply Voice Transcript", "apply-voice-transcript", [820, -220], [
  field("chatId", "={{ $('Extract Telegram Message').item.json.chatId }}"),
  field("telegramUserId", "={{ $('Extract Telegram Message').item.json.telegramUserId }}"),
  field("text", "={{ String($json.data?.text || ('Р“РѕР»РѕСЃРѕРІРѕРµ СЃРѕРѕР±С‰РµРЅРёРµ РЅРµ РѕР±СЂР°Р±РѕС‚Р°РЅРѕ: ' + ($json.error?.message || $json.message || 'STT РЅРµ РЅР°СЃС‚СЂРѕРµРЅ'))).trim() }}"),
  field("command", "={{ (() => { const t = String($json.data?.text || '').trim(); return t.startsWith('/') ? t.split(/\\s+/)[0].split('@')[0].toLowerCase() : ''; })() }}"),
  field("argsText", "={{ (() => { const t = String($json.data?.text || '').trim(); if (!t.startsWith('/')) return t; const first = t.split(/\\s+/)[0]; return t.slice(first.length).trim(); })() }}"),
  field("isVoice", "={{ true }}", "boolean"),
  field("voiceReplyRequested", "={{ Boolean($json.data?.wantsVoiceReply) }}", "boolean"),
  field("transcriptionProvider", "={{ $json.data?.provider || '' }}"),
  field("transcriptionModel", "={{ $json.data?.model || '' }}"),
  field("receivedAt", "={{ $('Extract Telegram Message').item.json.receivedAt }}"),
]));

add(switchNode("Route Request", "route-request", [1040, 0], [
  ["/start", "Help"],
  ["/help", "Help"],
  ["/agents", "Agents"],
  ["/google_connect", "Google Connect"],
  ["/google_status", "Google Status"],
  ["/tokens", "Tokens"],
  ["/metricon", "Metricon"],
  ["/platrum", "Platrum"],
  ["/bitrix", "Platrum Legacy"],
]));

add(setNode("Prepare Help Text", "prepare-help", [900, -520], [
  field("answerText", "={{ ['Starlab Agent', '', 'РћСЃРЅРѕРІРЅС‹Рµ РєРѕРјР°РЅРґС‹:', '/agents - СЃС‚Р°С‚СѓСЃ РїРѕРґРєР»СЋС‡РµРЅРЅС‹С… СѓСЃС‚СЂРѕР№СЃС‚РІ', '/platrum maksat - Р·Р°РґР°С‡Рё Platrum РїРѕ СЃРѕС‚СЂСѓРґРЅРёРєСѓ Рё РµРіРѕ РїСЂРѕРµРєС‚Р°Рј', '/google_connect - РїРѕРґРєР»СЋС‡РёС‚СЊ Google Р°РєРєР°СѓРЅС‚', '/google_status - РїСЂРѕРІРµСЂРёС‚СЊ Google', '/tokens - СЂР°СЃС…РѕРґ С‚РѕРєРµРЅРѕРІ', '', 'РњРѕР¶РЅРѕ РїРёСЃР°С‚СЊ РѕР±С‹С‡РЅС‹Рј С‚РµРєСЃС‚РѕРј:', 'Р”Р°Р№ РѕС‚С‡РµС‚ РїРѕ РњР°РєСЃР°С‚Сѓ Р·Р° РЅРµРґРµР»СЋ РїРѕ РєР°Р»РµРЅРґР°СЂСЋ Рё Platrum', 'Р”Р°Р№ РіСЂР°С„РёРє Р‘РµРіР°Р№С‹Рј СЃ 1 РїРѕ 5 РёСЋРЅСЏ'].join('\\n') }}"),
]));

add(httpNode("Get Device Agents", "get-devices", [900, -360], "GET", "={{ $env.CONTROL_PLANE_INTERNAL_URL + '/api/v1/device-agents' }}"));
add(setNode("Format Agents Report", "format-agents", [1200, -360], [
  field("answerText", "={{ (() => { const agents = $json.data?.agents || []; if (!agents.length) return 'РџРѕРґРєР»СЋС‡РµРЅРЅС‹Рµ СѓСЃС‚СЂРѕР№СЃС‚РІР°\\n\\nРџРѕРєР° СѓСЃС‚СЂРѕР№СЃС‚РІ РЅРµ РІРёРґРЅРѕ.'; return ['РџРѕРґРєР»СЋС‡РµРЅРЅС‹Рµ СѓСЃС‚СЂРѕР№СЃС‚РІР°', '', ...agents.map(a => `${a.displayName || a.deviceId}: ${a.status || 'unknown'}\\nРџРѕР»СЊР·РѕРІР°С‚РµР»СЊ: ${a.userId || '-'}\\nHost: ${a.hostname || '-'}\\nРџРѕСЃР»РµРґРЅРёР№ СЃРёРіРЅР°Р»: ${a.lastSeenAt || '-'}`)].join('\\n\\n'); })() }}"),
]));

add(httpNode("Start Google OAuth", "start-google", [900, -200], "GET", "={{ $env.CONTROL_PLANE_INTERNAL_URL + '/api/v1/google/oauth/start' }}"));
add(setNode("Format Google Connect", "format-google-connect", [1200, -200], [
  field("answerText", "={{ $json.ok ? ['РџРѕРґРєР»СЋС‡РµРЅРёРµ Google', '', 'РћС‚РєСЂРѕР№ СЃСЃС‹Р»РєСѓ Рё РІС‹РґР°Р№ РґРѕСЃС‚СѓРїС‹:', $json.data?.authorizationUrl || $json.data?.url || 'РЎСЃС‹Р»РєР° РЅРµ РїСЂРёС€Р»Р° РѕС‚ API'].join('\\n') : ['Google OAuth РЅРµ РіРѕС‚РѕРІ', '', $json.message || $json.error || 'Control-plane РЅРµ РІРµСЂРЅСѓР» СЃСЃС‹Р»РєСѓ РїРѕРґРєР»СЋС‡РµРЅРёСЏ.'].join('\\n') }}"),
]));

add(httpNode("Get Google Status", "get-google-status", [900, -40], "GET", "={{ $env.CONTROL_PLANE_INTERNAL_URL + '/api/v1/google/status' }}"));
add(setNode("Format Google Status", "format-google-status", [1200, -40], [
  field("answerText", "={{ $json.ok ? ['Google СЃС‚Р°С‚СѓСЃ', '', `РџРѕРґРєР»СЋС‡РµРЅ: ${$json.data?.connected ? 'РґР°' : 'РЅРµС‚'}`, `РђРєРєР°СѓРЅС‚: ${$json.data?.googleAccountEmail || '-'}`, `РћР±РЅРѕРІР»РµРЅ: ${$json.data?.updatedAt || '-'}`].join('\\n') : ['Google СЃС‚Р°С‚СѓСЃ', '', $json.message || $json.error || 'РќРµ СѓРґР°Р»РѕСЃСЊ РїРѕР»СѓС‡РёС‚СЊ СЃС‚Р°С‚СѓСЃ.'].join('\\n') }}"),
]));

add(httpNode("Get Token Usage", "get-token-usage", [900, 120], "GET", "={{ $env.CONTROL_PLANE_INTERNAL_URL + '/api/v1/token-usage/summary?period=day' }}"));
add(setNode("Format Token Report", "format-tokens", [1200, 120], [
  field("answerText", "={{ $json.ok ? ['РўРѕРєРµРЅС‹ Р·Р° 24 С‡Р°СЃР°', '', `Р’СЃРµРіРѕ: ${$json.data?.summary?.totalTokens || 0}`, `РЎРѕР±С‹С‚РёР№: ${$json.data?.summary?.eventCount || 0}`, `РџРµСЂРёРѕРґ: ${$json.data?.period?.from || '-'} - ${$json.data?.period?.to || '-'}`].join('\\n') : ['РўРѕРєРµРЅС‹', '', $json.message || $json.error || 'Р”РѕСЃС‚СѓРїРЅРѕ С‚РѕР»СЊРєРѕ РІР»Р°РґРµР»СЊС†Сѓ.'].join('\\n') }}"),
]));

add(httpNode("Resolve Metricon Target User", "resolve-metricon-target-user", [900, 280], "GET", "={{ $env.CONTROL_PLANE_INTERNAL_URL + '/api/v1/users/accessible' }}"));
add(httpNode("Read Metricon Activity", "read-metricon-activity", [1200, 280], "POST", "={{ $env.CONTROL_PLANE_INTERNAL_URL + '/api/v1/reports/metricon/activity-summary' }}", `={{ { targetUserId: ${targetUserFromMetriconUsersJs}, ...${metriconPeriodJs} } }}`));
add(setNode("Format Metricon Report", "format-metricon", [1500, 280], [
  field("answerText", "={{ $json.ok ? ['Metricon активность', '', `Период: ${$json.data?.from || '-'} - ${$json.data?.to || '-'}`, `Источник: ${$json.data?.source || '-'}`, '', ...($json.data?.employees || []).map(e => [`${e.user?.displayName || e.user?.id || '-'}`, `Активность: ${Math.round((e.metrics?.activeSeconds || 0) / 60)} мин`, `Простой: ${Math.round((e.metrics?.idleSeconds || 0) / 60)} мин`, `Всего: ${Math.round((e.metrics?.totalSeconds || 0) / 60)} мин`].join('\\n'))].join('\\n\\n') : ['Metricon активность', '', $json.message || $json.error?.message || $json.error || 'Не удалось получить данные Metricon.'].join('\\n') }}"),
]));

add(httpNode("Resolve Platrum Target User", "resolve-platrum-target-user", [900, 420], "GET", "={{ $env.CONTROL_PLANE_INTERNAL_URL + '/api/v1/users/accessible' }}"));
add(httpNode("Read Platrum User Status", "read-platrum-user", [1200, 420], "POST", "={{ $env.CONTROL_PLANE_INTERNAL_URL + '/api/v1/reports/platrum/user-status' }}", `={{ { userId: ${targetUserFromPlatrumUsersJs}, limit: 100 } }}`));
add(setNode("Format Platrum Report", "format-platrum", [1500, 420], [
  field("answerText", "={{ $json.ok ? ['Platrum СЃРІРѕРґРєР° РїРѕ СЃРѕС‚СЂСѓРґРЅРёРєСѓ', '', `РЎРѕС‚СЂСѓРґРЅРёРє: ${$json.data?.user?.displayName || '-'}`, `Р­С„С„РµРєС‚РёРІРЅРѕСЃС‚СЊ: ${$json.data?.combined?.summary?.efficiencyPercent ?? '-'}%`, `Р’С‹РїРѕР»РЅРµРЅРёРµ: ${$json.data?.combined?.summary?.completionPercent ?? '-'}%`, `Р’СЃРµРіРѕ Р·Р°РґР°С‡: ${$json.data?.combined?.summary?.total || 0}`, `РћС‚РєСЂС‹С‚Рѕ: ${$json.data?.combined?.summary?.open || 0}`, `Р—Р°РІРµСЂС€РµРЅРѕ: ${$json.data?.combined?.summary?.completed || 0}`, `РџСЂРѕСЃСЂРѕС‡РµРЅРѕ: ${$json.data?.combined?.summary?.overdue || 0}`, '', 'РџСЂРѕРµРєС‚С‹:', ...($json.data?.projects || []).map(p => `- ${p.project?.name || p.project?.id}: ${p.summary?.total ?? 0} Р·Р°РґР°С‡, СЌС„С„РµРєС‚РёРІРЅРѕСЃС‚СЊ ${p.summary?.efficiencyPercent ?? '-'}%, РѕС‚РєСЂС‹С‚Рѕ ${p.summary?.open ?? 0}, РїСЂРѕСЃСЂРѕС‡РµРЅРѕ ${p.summary?.overdue ?? 0}`), '', 'РџРѕСЃР»РµРґРЅРёРµ Р·Р°РґР°С‡Рё:', ...($json.data?.combined?.tasks || []).slice(0,12).map(t => `- ${t.title || t.id}: ${t.statusLabel || '-'}${t.overdue ? ' / РїСЂРѕСЃСЂРѕС‡РµРЅРѕ' : ''}`)].join('\\n') : ['Platrum СЃРІРѕРґРєР°', '', $json.message || $json.error || 'РќРµ СѓРґР°Р»РѕСЃСЊ РїРѕР»СѓС‡РёС‚СЊ РґР°РЅРЅС‹Рµ Platrum.'].join('\\n') }}"),
]));

add(httpNode("AI Get Actor", "ai-get-actor", [900, 560], "GET", "={{ $env.CONTROL_PLANE_INTERNAL_URL + '/api/v1/me' }}"));
add(httpNode("AI List Users", "ai-list-users", [1200, 560], "GET", "={{ $env.CONTROL_PLANE_INTERNAL_URL + '/api/v1/users/accessible' }}"));
add(httpNode("AI List Projects", "ai-list-projects", [1500, 560], "GET", "={{ $env.CONTROL_PLANE_INTERNAL_URL + '/api/v1/projects/accessible' }}"));
add(httpNode("AI Device Context", "ai-devices", [1800, 560], "GET", "={{ $env.CONTROL_PLANE_INTERNAL_URL + '/api/v1/device-agents' }}"));
add(httpNode("AI Google Snapshot", "ai-google", [2100, 460], "GET", googleSnapshotUrl));
add(httpNode("AI Platrum User Status", "ai-platrum", [2100, 660], "POST", "={{ $env.CONTROL_PLANE_INTERNAL_URL + '/api/v1/reports/platrum/user-status' }}", `={{ { userId: ${targetUserFromAiUsersJs}, limit: 100 } }}`));
add(httpNode("AI Metricon Activity", "ai-metricon", [2400, 760], "POST", "={{ $env.CONTROL_PLANE_INTERNAL_URL + '/api/v1/reports/metricon/activity-summary' }}", `={{ { targetUserId: ${targetUserFromAiUsersJs}, ...${metriconPeriodJs} } }}`));
add(setNode("Starlab Brain - Build AI Context", "starlab-brain", [2550, 560], [
  field("brain", "={{ { question: $('Extract Telegram Message').item.json.text, actor: $('AI Get Actor').item.json, accessibleUsers: $('AI List Users').item.json, projects: $('AI List Projects').item.json, devices: $('AI Device Context').item.json, google: $('AI Google Snapshot').item.json, platrum: $('AI Platrum User Status').item.json, metricon: $('AI Metricon Activity').item.json, instructions: 'Use Platrum userStatus first for projects/tasks. Use Metricon activity for actual computer activity, active time, idle time and work-time facts. Always include employee efficiencyPercent when Platrum analytics has it. Platrum and Metricon are read-only: never claim task or Metricon data changes/deletes/approvals. For calendar, prefer sharedCalendars/Other calendars over primary calendar when user asks work schedule. For Gmail, prefer workLikeMessages and ignore obvious personal mail. Produce a clean Russian Telegram report with tables/lists and clear caveats.' } }}", "object"),
]));
add(httpNode("Claude Assistant", "claude-assistant", [2850, 560], "POST", "https://api.anthropic.com/v1/messages", "={{ { model: $env.CLAUDE_MODEL || 'claude-sonnet-4-6', max_tokens: 2200, temperature: 0.2, system: 'РўС‹ РєРѕСЂРїРѕСЂР°С‚РёРІРЅС‹Р№ AI-Р°СЃСЃРёСЃС‚РµРЅС‚ Starlab Agent РґР»СЏ Telegram. РћС‚РІРµС‡Р°Р№ РЅР° СЂСѓСЃСЃРєРѕРј, РєСЂР°СЃРёРІРѕ Рё РїРѕРЅСЏС‚РЅРѕ. РќРµ РїРѕРєР°Р·С‹РІР°Р№ JSON, С‚РѕРєРµРЅС‹, webhook РёР»Рё debug. Р”Р»СЏ Platrum СЃРЅР°С‡Р°Р»Р° РёСЃРїРѕР»СЊР·СѓР№ combined summary, userTasks Рё РІСЃРµ project summaries. Р’СЃРµРіРґР° РїРѕРєР°Р·С‹РІР°Р№ СЌС„С„РµРєС‚РёРІРЅРѕСЃС‚СЊ СЃРѕС‚СЂСѓРґРЅРёРєР° РІ РїСЂРѕС†РµРЅС‚Р°С…, РµСЃР»Рё РµСЃС‚СЊ efficiencyPercent. Р”Р»СЏ РєР°Р»РµРЅРґР°СЂСЏ СЃРЅР°С‡Р°Р»Р° РёСЃРїРѕР»СЊР·СѓР№ sharedCalendars / Р”СЂСѓРіРёРµ РєР°Р»РµРЅРґР°СЂРё, Р° primary calendar СЃС‡РёС‚Р°Р№ РІС‚РѕСЂРёС‡РЅС‹Рј. Р”Р»СЏ Gmail РёСЃРїРѕР»СЊР·СѓР№ workLikeMessages Рё РѕС‚РґРµР»СЏР№ Р»РёС‡РЅС‹Рµ РїРёСЃСЊРјР° РѕС‚ СЂР°Р±РѕС‡РёС…. Р•СЃР»Рё РґР°РЅРЅС‹С… РЅРµС‚, С‡РµСЃС‚РЅРѕ СЃРєР°Р¶Рё РєР°РєРёС… РёРјРµРЅРЅРѕ РґР°РЅРЅС‹С… РЅРµ С…РІР°С‚Р°РµС‚ Рё С‡С‚Рѕ РїСЂРѕРІРµСЂРёС‚СЊ.', messages: [{ role: 'user', content: ['Р’РѕРїСЂРѕСЃ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ: ' + $('Extract Telegram Message').item.json.text, '', 'Starlab Brain context:', JSON.stringify($json.brain)].join('\\n') }] } }}", [
  { name: "content-type", value: "application/json" },
  { name: "accept", value: "application/json" },
  { name: "anthropic-version", value: "2023-06-01" },
  { name: "x-api-key", value: "={{ $env.CLAUDE_API_KEY }}" },
]));
add(setNode("Extract Claude Answer", "extract-claude", [3000, 560], [
  field("answerText", "={{ $json.content?.map(c => c.text || '').join('\\n').trim() || $json.error?.message || $json.message || 'Claude СЃРµР№С‡Р°СЃ РЅРµ РѕС‚РІРµС‚РёР». РџСЂРѕРІРµСЂСЊ API key, credits/model access.' }}"),
]));

add(switchNode("Route Reply Type", "route-reply-type", [3160, 560], [
  ["true", "Voice Reply"],
], routeVoiceReplyExpression, "Text Reply"));

add(httpNode("Send Telegram Voice Reply", "send-telegram-voice", [3300, 700], "POST", "={{ $env.CONTROL_PLANE_INTERNAL_URL + '/api/v1/voice/send-telegram' }}", "={{ { chatId: $('Extract Telegram Message').item.json.chatId, text: String($json.answerText || '').slice(0, 3900), caption: 'РћС‚РІРµС‚ РіРѕР»РѕСЃРѕРј' } }}"));

add(httpNode("Send Telegram Reply", "send-telegram", [3300, 0], "POST", "={{ 'https://api.telegram.org/bot' + $env.TELEGRAM_BOT_TOKEN + '/sendMessage' }}", "={{ { chat_id: $('Extract Telegram Message').item.json.chatId, text: String($json.answerText || 'РџСѓСЃС‚РѕР№ РѕС‚РІРµС‚').slice(0, 3900), disable_web_page_preview: true } }}", [
  { name: "content-type", value: "application/json" },
], false));

const workflow = {
  id: "starlabTelegramMvp01",
  name: "Starlab Agent - Telegram Visual Native",
  active: true,
  nodes,
  connections: {
    "Telegram Webhook": { main: [[link("Extract Telegram Message")]] },
    "Extract Telegram Message": { main: [[link("Route Input Type")]] },
    "Route Input Type": { main: [[link("Transcribe Telegram Voice")], [link("Route Request")]] },
    "Transcribe Telegram Voice": { main: [[link("Apply Voice Transcript")]] },
    "Apply Voice Transcript": { main: [[link("Route Request")]] },
    "Route Request": { main: [[link("Prepare Help Text")], [link("Prepare Help Text")], [link("Get Device Agents")], [link("Start Google OAuth")], [link("Get Google Status")], [link("Get Token Usage")], [link("Resolve Metricon Target User")], [link("Resolve Platrum Target User")], [link("Resolve Platrum Target User")], [link("AI Get Actor")]] },
    "Prepare Help Text": { main: [[link("Send Telegram Reply")]] },
    "Get Device Agents": { main: [[link("Format Agents Report")]] },
    "Format Agents Report": { main: [[link("Send Telegram Reply")]] },
    "Start Google OAuth": { main: [[link("Format Google Connect")]] },
    "Format Google Connect": { main: [[link("Send Telegram Reply")]] },
    "Get Google Status": { main: [[link("Format Google Status")]] },
    "Format Google Status": { main: [[link("Send Telegram Reply")]] },
    "Get Token Usage": { main: [[link("Format Token Report")]] },
    "Format Token Report": { main: [[link("Send Telegram Reply")]] },
    "Resolve Metricon Target User": { main: [[link("Read Metricon Activity")]] },
    "Read Metricon Activity": { main: [[link("Format Metricon Report")]] },
    "Format Metricon Report": { main: [[link("Send Telegram Reply")]] },
    "Resolve Platrum Target User": { main: [[link("Read Platrum User Status")]] },
    "Read Platrum User Status": { main: [[link("Format Platrum Report")]] },
    "Format Platrum Report": { main: [[link("Send Telegram Reply")]] },
    "AI Get Actor": { main: [[link("AI List Users")]] },
    "AI List Users": { main: [[link("AI List Projects")]] },
    "AI List Projects": { main: [[link("AI Device Context")]] },
    "AI Device Context": { main: [[link("AI Google Snapshot")]] },
    "AI Google Snapshot": { main: [[link("AI Platrum User Status")]] },
    "AI Platrum User Status": { main: [[link("AI Metricon Activity")]] },
    "AI Metricon Activity": { main: [[link("Starlab Brain - Build AI Context")]] },
    "Starlab Brain - Build AI Context": { main: [[link("Claude Assistant")]] },
    "Claude Assistant": { main: [[link("Extract Claude Answer")]] },
    "Extract Claude Answer": { main: [[link("Route Reply Type")]] },
    "Route Reply Type": { main: [[link("Send Telegram Voice Reply")], [link("Send Telegram Reply")]] },
  },
  settings: { executionOrder: "v1" },
  staticData: null,
  pinData: {},
  tags: [],
  triggerCount: 0,
  versionId: "starlab-telegram-visual-native-2",
};

patchWorkflowStrings(workflow);

fs.writeFileSync(outPath, `${JSON.stringify(workflow, null, 2)}\n`, "utf8");
console.log(outPath);

function patchWorkflowStrings(workflow) {
  setAssignment(
    workflow,
    "Apply Voice Transcript",
    "text",
    "={{ String($json.data?.text || ('Голосовое сообщение не обработано: ' + ($json.error?.message || $json.message || 'STT не настроен'))).trim() }}",
  );
  setAssignment(
    workflow,
    "Prepare Help Text",
    "answerText",
    "={{ ['Starlab Agent', '', 'Основные команды:', '/agents - статус подключенных устройств', '/metricon maksat - активность сотрудника в Metricon', '/platrum maksat - задачи Platrum по сотруднику и его проектам', '/google_connect - подключить Google аккаунт', '/google_status - проверить Google', '/tokens - расход токенов', '', 'Можно писать обычным текстом:', 'Дай отчет по Максату за неделю по календарю, Platrum и Metricon', 'Сколько Максат работал по Metricon?', 'Дай график Бегайым с 1 по 5 июня'].join('\\n') }}",
  );
  setAssignment(
    workflow,
    "Format Agents Report",
    "answerText",
    "={{ (() => { const agents = $json.data?.agents || []; if (!agents.length) return 'Подключенные устройства\\n\\nПока устройств не видно.'; return ['Подключенные устройства', '', ...agents.map(a => `${a.displayName || a.deviceId}: ${a.status || 'unknown'}\\nПользователь: ${a.userId || '-'}\\nHost: ${a.hostname || '-'}\\nПоследний сигнал: ${a.lastSeenAt || '-'}`)].join('\\n\\n'); })() }}",
  );
  setAssignment(
    workflow,
    "Format Google Connect",
    "answerText",
    "={{ $json.ok ? ['Подключение Google', '', 'Открой ссылку и выдай доступы:', $json.data?.authorizationUrl || $json.data?.url || 'Ссылка не пришла от API'].join('\\n') : ['Google OAuth не готов', '', $json.message || $json.error || 'Control-plane не вернул ссылку подключения.'].join('\\n') }}",
  );
  setAssignment(
    workflow,
    "Format Google Status",
    "answerText",
    "={{ $json.ok ? ['Google статус', '', `Подключен: ${$json.data?.connected ? 'да' : 'нет'}`, `Аккаунт: ${$json.data?.googleAccountEmail || '-'}`, `Обновлен: ${$json.data?.updatedAt || '-'}`].join('\\n') : ['Google статус', '', $json.message || $json.error || 'Не удалось получить статус.'].join('\\n') }}",
  );
  setAssignment(
    workflow,
    "Format Token Report",
    "answerText",
    "={{ $json.ok ? ['Токены за 24 часа', '', `Всего: ${$json.data?.summary?.totalTokens || 0}`, `Событий: ${$json.data?.summary?.eventCount || 0}`, `Период: ${$json.data?.period?.from || '-'} - ${$json.data?.period?.to || '-'}`].join('\\n') : ['Токены', '', $json.message || $json.error || 'Доступно только владельцу.'].join('\\n') }}",
  );
  setAssignment(
    workflow,
    "Format Metricon Report",
    "answerText",
    "={{ $json.ok ? ['Metricon активность', '', `Период: ${$json.data?.from || '-'} - ${$json.data?.to || '-'}`, `Источник: ${$json.data?.source || '-'}`, '', ...($json.data?.employees || []).map(e => [`${e.user?.displayName || e.user?.id || '-'}`, `Активность: ${Math.round((e.metrics?.activeSeconds || 0) / 60)} мин`, `Простой: ${Math.round((e.metrics?.idleSeconds || 0) / 60)} мин`, `Всего: ${Math.round((e.metrics?.totalSeconds || 0) / 60)} мин`].join('\\n'))].join('\\n\\n') : ['Metricon активность', '', $json.error?.message || $json.message || $json.error || 'Не удалось получить данные Metricon.'].join('\\n') }}",
  );
  setAssignment(
    workflow,
    "Format Platrum Report",
    "answerText",
    "={{ $json.ok ? ['Platrum сводка по сотруднику', '', `Сотрудник: ${$json.data?.user?.displayName || '-'}`, `Эффективность: ${$json.data?.combined?.summary?.efficiencyPercent ?? '-'}%`, `Выполнение: ${$json.data?.combined?.summary?.completionPercent ?? '-'}%`, `Всего задач: ${$json.data?.combined?.summary?.total || 0}`, `Открыто: ${$json.data?.combined?.summary?.open || 0}`, `Завершено: ${$json.data?.combined?.summary?.completed || 0}`, `Просрочено: ${$json.data?.combined?.summary?.overdue || 0}`, '', 'Проекты:', ...($json.data?.projects || []).map(p => `- ${p.project?.name || p.project?.id}: ${p.summary?.total ?? 0} задач, эффективность ${p.summary?.efficiencyPercent ?? '-'}%, открыто ${p.summary?.open ?? 0}, просрочено ${p.summary?.overdue ?? 0}`), '', 'Последние задачи:', ...($json.data?.combined?.tasks || []).slice(0,12).map(t => `- ${t.title || t.id}: ${t.statusLabel || '-'}${t.overdue ? ' / просрочено' : ''}`)].join('\\n') : ['Platrum сводка', '', $json.message || $json.error || 'Не удалось получить данные Platrum.'].join('\\n') }}",
  );
  setJsonBody(
    workflow,
    "Read Platrum User Status",
    "={{ { userId: (() => { const users = $('Resolve Platrum Target User').item.json.data?.users || []; const text = (($('Extract Telegram Message').item.json.text || '') + ' ' + ($('Extract Telegram Message').item.json.argsText || '')).toLowerCase().replace(/ё/g, 'е'); return (users.find(u => text.includes(String(u.displayName || '').toLowerCase()) || text.includes(String(u.employeeId || '').toLowerCase()) || (u.id === 'u-maksat' && (text.includes('максат') || text.includes('maksat'))) || (u.id === 'u-pm-1' && (text.includes('бегай') || text.includes('бегайым') || text.includes('begay') || text.includes('begoim') || text.includes('pm1')))) || users[0] || {}).id || 'u-maksat'; })(), limit: 100 } }}",
  );
  setUrl(
    workflow,
    "AI Google Snapshot",
    "={{ (() => { const users = $('AI List Users').item.json.data?.users || []; const text = String($('Extract Telegram Message').item.json.text || '').toLowerCase().replace(/ё/g, 'е'); const target = users.find(u => text.includes(String(u.displayName || '').toLowerCase()) || text.includes(String(u.employeeId || '').toLowerCase()) || (u.id === 'u-maksat' && (text.includes('максат') || text.includes('maksat'))) || (u.id === 'u-pm-1' && (text.includes('бегай') || text.includes('бегайым') || text.includes('begay') || text.includes('begoim')))) || users[0] || { id: 'u-maksat', displayName: 'Maksat', employeeId: 'maksat' }; const name = target.displayName || ''; const employee = target.employeeId || ''; const terms = [name, employee, name + ' Работа', name + ' work', name + ' PM', employee + ' work', 'рабочий график', 'работа', 'ПМ', 'PM', 'work'].filter(Boolean).map(v => '&calendarSearchTerm=' + encodeURIComponent(v)).join(''); return $env.CONTROL_PLANE_INTERNAL_URL + '/api/v1/google/workspace-snapshot?period=week' + '&calendarEvents=50&calendarList=200&sharedCalendarMatches=20&sharedCalendarEvents=50' + '&gmailMessages=25&driveFiles=25&documentFiles=8&docCharLimit=5000' + '&userId=' + encodeURIComponent(target.id) + terms; })() }}",
  );
  setJsonBody(
    workflow,
    "AI Platrum User Status",
    "={{ { userId: (() => { const users = $('AI List Users').item.json.data?.users || []; const text = (($('Extract Telegram Message').item.json.text || '') + ' ' + ($('Extract Telegram Message').item.json.argsText || '')).toLowerCase().replace(/ё/g, 'е'); return (users.find(u => text.includes(String(u.displayName || '').toLowerCase()) || text.includes(String(u.employeeId || '').toLowerCase()) || (u.id === 'u-maksat' && (text.includes('максат') || text.includes('maksat'))) || (u.id === 'u-pm-1' && (text.includes('бегай') || text.includes('бегайым') || text.includes('begay') || text.includes('begoim') || text.includes('pm1')))) || users[0] || {}).id || 'u-maksat'; })(), limit: 100 } }}",
  );
  setJsonBody(
    workflow,
    "AI Metricon Activity",
    `={{ { targetUserId: ${targetUserFromAiUsersJs}, ...${metriconPeriodJs} } }}`,
  );
  setJsonBody(
    workflow,
    "Claude Assistant",
    "={{ { model: $env.CLAUDE_MODEL || 'claude-sonnet-4-6', max_tokens: 2200, temperature: 0.2, system: 'Ты корпоративный AI-ассистент Starlab Agent для Telegram. Отвечай на русском, красиво, структурно и понятно. Не показывай JSON, токены, webhook или debug. Для задач и проектов сначала используй Platrum: combined summary, userTasks, project summaries, dailyReports и analytics. Для фактической активности за компьютером используй Metricon: activeSeconds, idleSeconds, totalSeconds, приложения и сырые поля, если они есть. Всегда показывай эффективность сотрудника в процентах, если есть efficiencyPercent. Platrum и Metricon доступны только для чтения: никогда не говори, что создал, изменил, удалил, согласовал или переместил задачу или данные активности. Для календаря сначала используй sharedCalendars / Другие календари, а primary calendar считай вторичным. Для Gmail используй workLikeMessages и отделяй личные письма от рабочих. Если данных нет, честно скажи, каких именно данных не хватает и что проверить.', messages: [{ role: 'user', content: ['Вопрос пользователя: ' + $('Extract Telegram Message').item.json.text, '', 'Starlab Brain context:', JSON.stringify($json.brain)].join('\\n') }] } }}",
  );
  setAssignment(
    workflow,
    "Extract Claude Answer",
    "answerText",
    "={{ $json.content?.map(c => c.text || '').join('\\n').trim() || $json.error?.message || $json.message || 'Claude сейчас не ответил. Проверь API key, credits/model access.' }}",
  );
  setJsonBody(
    workflow,
    "Send Telegram Voice Reply",
    "={{ { chatId: $('Extract Telegram Message').item.json.chatId, text: String($json.answerText || '').slice(0, 3900), caption: 'Ответ голосом' } }}",
  );
  setJsonBody(
    workflow,
    "Send Telegram Reply",
    "={{ { chat_id: $('Extract Telegram Message').item.json.chatId, text: String($json.answerText || 'Пустой ответ').slice(0, 3900), disable_web_page_preview: true } }}",
  );
}

function setAssignment(workflow, nodeName, fieldName, value) {
  const assignment = workflow.nodes
    .find((node) => node.name === nodeName)
    ?.parameters?.assignments?.assignments?.find((item) => item.name === fieldName);
  if (!assignment) {
    throw new Error(`Missing assignment ${nodeName}.${fieldName}`);
  }
  assignment.value = value;
}

function setJsonBody(workflow, nodeName, value) {
  const node = workflow.nodes.find((item) => item.name === nodeName);
  if (!node?.parameters) {
    throw new Error(`Missing node ${nodeName}`);
  }
  node.parameters.jsonBody = value;
}

function setUrl(workflow, nodeName, value) {
  const node = workflow.nodes.find((item) => item.name === nodeName);
  if (!node?.parameters) {
    throw new Error(`Missing node ${nodeName}`);
  }
  node.parameters.url = value;
}

function webhook(name, id, position) {
  return {
    parameters: { httpMethod: "POST", path: "starlab-telegram", responseMode: "onReceived", options: {} },
    id,
    name,
    type: "n8n-nodes-base.webhook",
    typeVersion: 2,
    position,
    webhookId: "starlab-telegram",
  };
}

function setNode(name, id, position, assignments) {
  return {
    parameters: { assignments: { assignments }, options: {} },
    id,
    name,
    type: "n8n-nodes-base.set",
    typeVersion: 3.4,
    position,
  };
}

function field(name, value, type = "string") {
  return { id: `${name}-${Math.random().toString(16).slice(2)}`, name, value, type };
}

function switchNode(name, id, position, commandRules, leftValue = "={{ $json.command }}", fallbackName = "AI Assistant") {
  return {
    parameters: {
      mode: "rules",
      rules: {
        values: commandRules.map(([command, outputKey]) => ({
          outputKey,
          conditions: {
            options: { caseSensitive: false, leftValue: "", typeValidation: "strict" },
            conditions: [{ leftValue, rightValue: command, operator: { type: "string", operation: "equals" } }],
            combinator: "and",
          },
        })),
      },
      options: { fallbackOutput: "extra", renameFallbackOutput: fallbackName },
    },
    id,
    name,
    type: "n8n-nodes-base.switch",
    typeVersion: 3.4,
    position,
  };
}

function httpNode(name, id, position, method, url, jsonBody = "", headers = actorHeaders(), sendDefaultHeaders = true) {
  const finalHeaders = sendDefaultHeaders ? headers : headers;
  return {
    parameters: {
      method,
      url,
      sendHeaders: finalHeaders.length > 0,
      specifyHeaders: "keypair",
      headerParameters: { parameters: finalHeaders },
      sendBody: Boolean(jsonBody),
      contentType: "json",
      specifyBody: "json",
      jsonBody,
      options: { response: { response: { neverError: true, responseFormat: "json" } } },
    },
    id,
    name,
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.4,
    position,
  };
}

function actorHeaders() {
  return [
    { name: "x-actor-telegram-id", value: "={{ $('Extract Telegram Message').item.json.telegramUserId }}" },
    { name: "accept", value: "application/json" },
    { name: "content-type", value: "application/json" },
  ];
}

function link(node) {
  return { node, type: "main", index: 0 };
}
