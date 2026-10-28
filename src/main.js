/**
 * ============================================================================
 * LogiEngine AI — Controlador Principal de Aplicação e Telemetria (main.js)
 * ============================================================================
 * Orquestra os 3 painéis da interface de engenharia:
 * 1. Painel Esquerdo: Formulário de Rota, CEPs, Contexto e Presets Rápidos
 * 2. Painel Central: KPIs Executivos, Alocação e Comparativo Estático vs IA
 * 3. Painel Direito: JSON Payload com Syntax Highlighting + Tabela SQL de Logs
 */

import {
  formatCep,
  estimateRouteDistanceFromCeps,
  calculateDeterministicPricing,
  combineDeterministicAndAiPricing,
  SCENARIO_PRESETS
} from './domain/pricingEngine.js';

import {
  LOGIENGINE_SYSTEM_INSTRUCTION,
  LOGIENGINE_RESPONSE_JSON_SCHEMA,
  executeLogisticsInference
} from './services/geminiService.js';

import {
  insertQuotationRecord,
  listQuotationRecords,
  clearAllQuotationRecords,
  exportTelemetryLogs
} from './storage/telemetryStore.js';

import {
  formatBrl,
  formatTelemetryTime,
  getRiskBadgeMeta,
  syntaxHighlightJson
} from './ui/syntaxHighlighter.js';

const SESSION_KEY_STORAGE = 'logiengine_gemini_api_key_session';

// Estado em memória da sessão
const appState = {
  currentRecord: null,
  historyRecords: [],
  isProcessing: false
};

// Elementos do DOM
const dom = {
  // Header & API Key
  apiKeyInput: document.getElementById('gemini-api-key'),
  btnToggleKeyVis: document.getElementById('btn-toggle-key-visibility'),
  engineModeDot: document.getElementById('engine-mode-dot'),
  engineModeText: document.getElementById('engine-mode-text'),
  btnOpenPromptModal: document.getElementById('btn-open-prompt-modal'),
  contractModal: document.getElementById('contract-modal'),
  btnCloseModal: document.getElementById('btn-close-modal'),
  modalSystemPrompt: document.getElementById('modal-system-prompt'),
  modalJsonSchema: document.getElementById('modal-json-schema'),

  // Painel Esquerdo (Inputs & Presets)
  pricingForm: document.getElementById('pricing-form'),
  originCepInput: document.getElementById('origin-cep'),
  destCepInput: document.getElementById('dest-cep'),
  originRegionHint: document.getElementById('origin-region-hint'),
  destRegionHint: document.getElementById('dest-region-hint'),
  distanceKmInput: document.getElementById('distance-km'),
  weightKgInput: document.getElementById('weight-kg'),
  volumeCategorySelect: document.getElementById('volume-category'),
  weatherSelect: document.getElementById('weather-select'),
  trafficSelect: document.getElementById('traffic-select'),
  courierDemandSelect: document.getElementById('courier-demand-select'),
  btnRecalcCepDistance: document.getElementById('btn-recalc-cep-distance'),
  btnRunEngine: document.getElementById('btn-run-engine'),
  btnRunEngineLabel: document.getElementById('btn-run-engine-label'),
  presetButtons: document.querySelectorAll('.preset-btn'),

  // Painel Central (KPIs Executivos & Comparativo)
  activeRouteSummary: document.getElementById('active-route-summary'),
  kpiConfidenceScore: document.getElementById('kpi-confidence-score'),
  kpiSurgePill: document.getElementById('kpi-surge-pill'),
  kpiFinalPrice: document.getElementById('kpi-final-price'),
  kpiPriceFormula: document.getElementById('kpi-price-formula'),
  kpiSlaDelta: document.getElementById('kpi-sla-delta'),
  kpiSlaMinutes: document.getElementById('kpi-sla-minutes'),
  kpiSlaSubtext: document.getElementById('kpi-sla-subtext'),
  kpiRiskCode: document.getElementById('kpi-risk-code'),
  kpiRiskBadge: document.getElementById('kpi-risk-badge'),
  kpiRiskSubtitle: document.getElementById('kpi-risk-subtitle'),
  kpiRoutingRecommendation: document.getElementById('kpi-routing-recommendation'),
  kpiBottleneckList: document.getElementById('kpi-bottleneck-list'),

  // Comparativo Lado a Lado
  comparisonDeltaPill: document.getElementById('comparison-delta-pill'),
  compStaticFixed: document.getElementById('comp-static-fixed'),
  compStaticKm: document.getElementById('comp-static-km'),
  compStaticDistCost: document.getElementById('comp-static-dist-cost'),
  compStaticAddon: document.getElementById('comp-static-addon'),
  compStaticTotal: document.getElementById('comp-static-total'),
  compStaticSla: document.getElementById('comp-static-sla'),
  compDynBase: document.getElementById('comp-dyn-base'),
  compDynSurge: document.getElementById('comp-dyn-surge'),
  compDynDelta: document.getElementById('comp-dyn-delta'),
  compDynRisk: document.getElementById('comp-dyn-risk'),
  compDynTotal: document.getElementById('comp-dyn-total'),
  compDynSla: document.getElementById('comp-dyn-sla'),

  // Painel Direito (Telemetria & Observabilidade)
  tabBtnJson: document.getElementById('tab-btn-json'),
  tabBtnMetrics: document.getElementById('tab-btn-metrics'),
  tabPanelJson: document.getElementById('tab-panel-json'),
  tabPanelMetrics: document.getElementById('tab-panel-metrics'),
  logsCountBadge: document.getElementById('logs-count-badge'),
  payloadTxId: document.getElementById('payload-tx-id'),
  btnCopyJson: document.getElementById('btn-copy-json'),
  jsonPayloadViewer: document.getElementById('json-payload-viewer'),
  qtHttpStatus: document.getElementById('qt-http-status'),
  qtLatency: document.getElementById('qt-latency'),
  qtModel: document.getElementById('qt-model'),

  metricHttpStatus: document.getElementById('metric-http-status'),
  metricLatencyMs: document.getElementById('metric-latency-ms'),
  metricAvgLatency: document.getElementById('metric-avg-latency'),
  metricModelName: document.getElementById('metric-model-name'),
  metricEngineMode: document.getElementById('metric-engine-mode'),
  btnExportCsv: document.getElementById('btn-export-csv'),
  btnExportJson: document.getElementById('btn-export-json'),
  btnClearLogs: document.getElementById('btn-clear-logs'),
  telemetryLogsTbody: document.getElementById('telemetry-logs-tbody')
};

/**
 * Inicialização da aplicação
 */
async function initApp() {
  // Restaura API Key da sessão (se houver)
  const savedKey = sessionStorage.getItem(SESSION_KEY_STORAGE) || '';
  if (savedKey) {
    dom.apiKeyInput.value = savedKey;
  }
  updateEngineModeIndicator();

  // Preenche o modal de System Prompt & JSON Schema
  dom.modalSystemPrompt.textContent = LOGIENGINE_SYSTEM_INSTRUCTION;
  dom.modalJsonSchema.innerHTML = syntaxHighlightJson(LOGIENGINE_RESPONSE_JSON_SCHEMA);

  // Registra Listeners de UI
  bindEvents();

  // Carrega histórico persistido no IndexedDB / LocalStorage
  appState.historyRecords = await listQuotationRecords();
  renderTelemetryLogsTable();

  // Executa o cenário inicial automaticamente para popular todos os painéis
  await applyScenarioPreset('NORMAL_LUNCH');
}

/**
 * Atualiza o indicador visual de modo Live Gemini API vs Simulação Realista
 */
function updateEngineModeIndicator() {
  const hasKey = Boolean(dom.apiKeyInput.value.trim());
  if (hasKey) {
    dom.engineModeDot.classList.add('is-live');
    dom.engineModeText.textContent = 'Google Gemini API Conectada (Live Mode)';
  } else {
    dom.engineModeDot.classList.remove('is-live');
    dom.engineModeText.textContent = 'Modo Simulação Realista (Mock Engine)';
  }
}

/**
 * Lê os valores atuais do formulário de entrada
 */
function readFormParameters() {
  return {
    originCep: formatCep(dom.originCepInput.value),
    destCep: formatCep(dom.destCepInput.value),
    distanceKm: parseFloat(dom.distanceKmInput.value) || 4.2,
    weightKg: parseFloat(dom.weightKgInput.value) || 1.5,
    volumeCategory: dom.volumeCategorySelect.value || 'SMALL',
    weather: dom.weatherSelect.value,
    traffic: dom.trafficSelect.value,
    courierDemand: dom.courierDemandSelect.value
  };
}

/**
 * Aplica um dos 3 Presets Rápidos e dispara o motor de cotação com 1 clique
 */
async function applyScenarioPreset(presetKey) {
  const preset = SCENARIO_PRESETS[presetKey];
  if (!preset) return;

  dom.originCepInput.value = preset.originCep;
  dom.destCepInput.value = preset.destCep;
  dom.distanceKmInput.value = preset.distanceKm;
  dom.weightKgInput.value = preset.weightKg;
  dom.volumeCategorySelect.value = preset.volumeCategory;
  dom.weatherSelect.value = preset.weather;
  dom.trafficSelect.value = preset.traffic;
  dom.courierDemandSelect.value = preset.courierDemand;

  // Destaca o botão de preset ativo
  dom.presetButtons.forEach(btn => {
    btn.classList.toggle('is-active', btn.dataset.preset === presetKey);
  });

  updateCepRegionHints();
  await runPricingPipeline();
}

/**
 * Atualiza dicas de bairro/região baseadas nos CEPs digitados
 */
function updateCepRegionHints() {
  const geo = estimateRouteDistanceFromCeps(
    dom.originCepInput.value,
    dom.destCepInput.value
  );
  dom.originRegionHint.textContent = geo.originRegion;
  dom.destRegionHint.textContent = geo.destRegion;
  return geo;
}

/**
 * Pipeline Principal:
 * 1. Executa a Camada de Domínio (Regras Determinísticas)
 * 2. Executa a Camada de Inteligência (Google Gemini API / Mock Realista)
 * 3. Persiste na Tabela SQL Local (IndexedDB + LocalStorage)
 * 4. Atualiza os Painéis Central e Direito
 */
async function runPricingPipeline() {
  if (appState.isProcessing) return;
  appState.isProcessing = true;
  dom.btnRunEngine.disabled = true;
  dom.btnRunEngineLabel.textContent = 'Processando Inferência LogiEngine AI...';

  try {
    const inputParams = readFormParameters();

    // 1. Camada de Domínio Determinística
    const deterministicData = calculateDeterministicPricing(inputParams);

    // 2. Camada de Inteligência (Gemini API ou fallback Mock caso ocorra erro de chave/rede)
    const apiKey = dom.apiKeyInput.value.trim();
    let inferenceResult;

    try {
      inferenceResult = await executeLogisticsInference({
        apiKey,
        contextPayload: inputParams,
        deterministicData
      });
    } catch (apiError) {
      console.warn('[LogiEngine AI] Erro na API Live, acionando Fallback resiliente:', apiError);
      inferenceResult = await executeLogisticsInference({
        apiKey: '',
        forceMock: true,
        contextPayload: inputParams,
        deterministicData
      });
      inferenceResult.telemetry.httpStatus = `200 OK (Fallback de ${apiError.httpCode || 'ERR'})`;
    }

    // 3. Combinação Executiva (Determinístico x Surge Multiplier IA)
    const combined = combineDeterministicAndAiPricing(
      deterministicData,
      inferenceResult.payload
    );

    // 4. Persistência Transacional
    const savedRecord = await insertQuotationRecord({
      inputParameters: inputParams,
      deterministicData: combined.deterministic,
      aiPayload: combined.ai,
      executiveSummary: combined.executiveSummary,
      telemetry: inferenceResult.telemetry
    });

    appState.currentRecord = savedRecord;
    appState.historyRecords = await listQuotationRecords();

    // 5. Renderiza UI
    renderExecutiveCenterPanel(combined, savedRecord);
    renderTelemetryRightPanel(savedRecord);
    renderTelemetryLogsTable();
  } finally {
    appState.isProcessing = false;
    dom.btnRunEngine.disabled = false;
    dom.btnRunEngineLabel.textContent = 'Executar Motor de Precificação & SLA';
  }
}

/**
 * Renderiza o Painel Central (KPIs Executivos, Recomendação e Comparativo A/B)
 */
function renderExecutiveCenterPanel(combined, record) {
  const { deterministic, ai, executiveSummary } = combined;

  dom.activeRouteSummary.textContent = `${deterministic.originCep} (${deterministic.originRegion}) → ${deterministic.destCep} (${deterministic.destRegion}) • ${deterministic.distanceKm} km`;

  // Confidence Score
  const confidencePct = Math.round(ai.confidence_score * 100);
  dom.kpiConfidenceScore.textContent = `${confidencePct}%`;

  // Card 1: Valor Final do Frete
  dom.kpiSurgePill.textContent = `${ai.surge_multiplier.toFixed(2)}x Surge`;
  dom.kpiFinalPrice.textContent = formatBrl(executiveSummary.finalDynamicPriceBrl);
  dom.kpiPriceFormula.textContent = `Taxa Base ${formatBrl(deterministic.baseTotalBrl)} × ${ai.surge_multiplier.toFixed(2)} Surge`;

  // Card 2: SLA Estimado
  dom.kpiSlaMinutes.textContent = String(ai.estimated_sla_minutes);
  const slaDiff = executiveSummary.slaDeltaMinutes;
  const slaSign = slaDiff >= 0 ? `+${slaDiff}` : String(slaDiff);
  dom.kpiSlaDelta.textContent = `${slaSign} min vs Estático`;
  const minWindow = Math.max(10, ai.estimated_sla_minutes - 2);
  const maxWindow = ai.estimated_sla_minutes + 4;
  dom.kpiSlaSubtext.textContent = `Janela operacional: ${minWindow}–${maxWindow} min`;

  // Card 3: Badge de Risco Logístico
  const riskMeta = getRiskBadgeMeta(ai.risk_level);
  dom.kpiRiskCode.textContent = `LVL: ${riskMeta.code}`;
  dom.kpiRiskBadge.className = `risk-badge ${riskMeta.className}`;
  dom.kpiRiskBadge.textContent = riskMeta.label;
  dom.kpiRiskSubtitle.textContent = riskMeta.subtitle;

  // Recomendação Técnica & Fatores de Gargalo
  dom.kpiRoutingRecommendation.textContent = ai.routing_recommendation;
  dom.kpiBottleneckList.innerHTML = '';
  ai.bottleneck_factors.forEach(factor => {
    const li = document.createElement('li');
    li.className = 'bottleneck-chip';
    li.textContent = factor;
    dom.kpiBottleneckList.appendChild(li);
  });

  // Comparativo Lado a Lado (Estático vs Dinâmico com IA)
  const deltaBrlFormatted = formatBrl(executiveSummary.surgeDeltaBrl);
  dom.comparisonDeltaPill.textContent =
    executiveSummary.surgeDeltaBrl > 0
      ? `+${deltaBrlFormatted} (+${executiveSummary.surgePercentage}%) Incentivo Dinâmico`
      : 'Operação em Tarifa Base Nominal (0% Surge)';

  dom.compStaticFixed.textContent = formatBrl(deterministic.fixedFeeBrl);
  dom.compStaticKm.textContent = String(deterministic.distanceKm);
  dom.compStaticDistCost.textContent = formatBrl(deterministic.distanceCostBrl);
  dom.compStaticAddon.textContent = formatBrl(deterministic.totalWeightVolumeAddonBrl);
  dom.compStaticTotal.textContent = formatBrl(deterministic.baseTotalBrl);
  dom.compStaticSla.textContent = `${deterministic.staticSlaMinutes} min`;

  dom.compDynBase.textContent = formatBrl(deterministic.baseTotalBrl);
  dom.compDynSurge.textContent = `${ai.surge_multiplier.toFixed(2)}x`;
  dom.compDynDelta.textContent = `+${deltaBrlFormatted}`;
  dom.compDynRisk.textContent = ai.risk_level;
  dom.compDynTotal.textContent = formatBrl(executiveSummary.finalDynamicPriceBrl);
  dom.compDynSla.textContent = `${ai.estimated_sla_minutes} min`;
}

/**
 * Renderiza o Painel Direito (JSON Payload Bruto c/ Syntax Highlighting + Métricas)
 */
function renderTelemetryRightPanel(record) {
  if (!record) return;

  // Objeto JSON bruto exato retornado pelo LLM
  const rawAiJson = record.ai_response_payload;
  dom.jsonPayloadViewer.innerHTML = syntaxHighlightJson(rawAiJson);
  dom.payloadTxId.textContent = `tx: ${record.transaction_id.slice(0, 13)}...`;

  // Rodapé rápido da aba JSON
  dom.qtHttpStatus.textContent = record.http_status;
  dom.qtLatency.textContent = `${record.latency_ms} ms`;
  dom.qtModel.textContent = 'gemini-2.5-flash / 3.8-flash';

  // Cards da aba Metrics & Logs
  dom.metricHttpStatus.textContent = record.http_status;
  dom.metricLatencyMs.textContent = `${record.latency_ms} ms`;
  dom.metricModelName.textContent = record.model_used;
  dom.metricEngineMode.textContent =
    record.execution_mode === 'LIVE_GEMINI_API'
      ? 'Google Gemini API (Live)'
      : 'Simulação Determinística (Mock)';

  // Latência média histórica
  if (appState.historyRecords.length > 0) {
    const sumLat = appState.historyRecords.reduce((acc, r) => acc + (Number(r.latency_ms) || 0), 0);
    const avgLat = Math.round(sumLat / appState.historyRecords.length);
    dom.metricAvgLatency.textContent = `Média (${appState.historyRecords.length} reqs): ${avgLat} ms`;
  }
}

/**
 * Renderiza a tabela de histórico SQL (`tb_logistics_quotations`)
 */
function renderTelemetryLogsTable() {
  const records = appState.historyRecords;
  dom.logsCountBadge.textContent = String(records.length);
  dom.telemetryLogsTbody.innerHTML = '';

  if (records.length === 0) {
    const emptyRow = document.createElement('tr');
    emptyRow.innerHTML = `<td colspan="6" style="text-align:center;color:var(--text-muted);padding:18px;">Nenhuma transação registrada na tabela local.</td>`;
    dom.telemetryLogsTbody.appendChild(emptyRow);
    return;
  }

  records.forEach(row => {
    const tr = document.createElement('tr');
    if (appState.currentRecord && appState.currentRecord.transaction_id === row.transaction_id) {
      tr.classList.add('is-selected');
    }

    const shortUuid = row.transaction_id.slice(0, 8);
    const timeFormatted = formatTelemetryTime(row.created_at);
    const riskMeta = getRiskBadgeMeta(row.risk_level);

    tr.innerHTML = `
      <td>
        <div><strong>${shortUuid}</strong></div>
        <div style="color:var(--text-muted);font-size:0.65rem;">${timeFormatted}</div>
      </td>
      <td>
        <div>${row.origin_cep} → ${row.destination_cep}</div>
        <div style="color:var(--text-secondary);font-size:0.66rem;">${row.distance_km} km • ${row.weather_condition}</div>
      </td>
      <td>
        <div style="color:var(--accent-green-bright);font-weight:700;">${formatBrl(row.dynamic_price_brl)}</div>
        <div style="color:var(--text-muted);font-size:0.65rem;">${Number(row.surge_multiplier).toFixed(2)}x (Base ${formatBrl(row.static_price_brl)})</div>
      </td>
      <td><strong>${row.estimated_sla_minutes}m</strong></td>
      <td><span class="json-token-enum json-token-enum--${String(row.risk_level).toLowerCase()}">${riskMeta.code}</span></td>
      <td>${row.latency_ms} ms</td>
    `;

    // Ao clicar em uma linha do histórico, restaura a inspeção daquela transação
    tr.addEventListener('click', () => {
      appState.currentRecord = row;
      const reconstructedDeterministic = calculateDeterministicPricing({
        originCep: row.origin_cep,
        destCep: row.destination_cep,
        distanceKm: row.distance_km,
        weightKg: row.weight_kg || 1.5,
        volumeCategory: row.volume_category || 'SMALL'
      });
      const combined = combineDeterministicAndAiPricing(
        reconstructedDeterministic,
        row.ai_response_payload
      );
      renderExecutiveCenterPanel(combined, row);
      renderTelemetryRightPanel(row);
      renderTelemetryLogsTable();
    });

    dom.telemetryLogsTbody.appendChild(tr);
  });
}

/**
 * Configura todos os eventos de interação da UI
 */
function bindEvents() {
  // Campo de API Key
  dom.apiKeyInput.addEventListener('input', () => {
    sessionStorage.setItem(SESSION_KEY_STORAGE, dom.apiKeyInput.value.trim());
    updateEngineModeIndicator();
  });

  dom.btnToggleKeyVis.addEventListener('click', () => {
    const isPassword = dom.apiKeyInput.type === 'password';
    dom.apiKeyInput.type = isPassword ? 'text' : 'password';
  });

  // Modal de Contrato & System Prompt
  dom.btnOpenPromptModal.addEventListener('click', () => {
    dom.contractModal.showModal();
  });

  dom.btnCloseModal.addEventListener('click', () => {
    dom.contractModal.close();
  });

  dom.contractModal.addEventListener('click', e => {
    if (e.target === dom.contractModal) dom.contractModal.close();
  });

  // Formatação de CEP e auto-cálculo de distância
  [dom.originCepInput, dom.destCepInput].forEach(input => {
    input.addEventListener('input', () => {
      input.value = formatCep(input.value);
      updateCepRegionHints();
    });
  });

  dom.btnRecalcCepDistance.addEventListener('click', () => {
    const geo = updateCepRegionHints();
    dom.distanceKmInput.value = geo.distanceKm;
  });

  // Botões de Presets Rápidos (1-Click)
  dom.presetButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const presetKey = btn.dataset.preset;
      applyScenarioPreset(presetKey);
    });
  });

  // Submissão manual do formulário
  dom.pricingForm.addEventListener('submit', e => {
    e.preventDefault();
    dom.presetButtons.forEach(b => b.classList.remove('is-active'));
    runPricingPipeline();
  });

  // Alternância de Abas no Painel Direito (JSON Payload vs Metrics & Logs)
  const switchTab = targetTab => {
    const isJson = targetTab === 'json';
    dom.tabBtnJson.classList.toggle('is-active', isJson);
    dom.tabBtnJson.setAttribute('aria-selected', String(isJson));
    dom.tabBtnMetrics.classList.toggle('is-active', !isJson);
    dom.tabBtnMetrics.setAttribute('aria-selected', String(!isJson));

    dom.tabPanelJson.hidden = !isJson;
    dom.tabPanelMetrics.hidden = isJson;
  };

  dom.tabBtnJson.addEventListener('click', () => switchTab('json'));
  dom.tabBtnMetrics.addEventListener('click', () => switchTab('metrics'));

  // Copiar JSON Payload
  dom.btnCopyJson.addEventListener('click', async () => {
    if (!appState.currentRecord) return;
    const rawText = JSON.stringify(appState.currentRecord.ai_response_payload, null, 2);
    try {
      await navigator.clipboard.writeText(rawText);
      const originalText = dom.btnCopyJson.textContent;
      dom.btnCopyJson.textContent = '✓ Copiado!';
      setTimeout(() => {
        dom.btnCopyJson.textContent = originalText;
      }, 1500);
    } catch {
      // ignora caso clipboard esteja restrito
    }
  });

  // Exportação de Logs (CSV / JSON) e Limpeza
  dom.btnExportCsv.addEventListener('click', () => {
    exportTelemetryLogs(appState.historyRecords, 'csv');
  });

  dom.btnExportJson.addEventListener('click', () => {
    exportTelemetryLogs(appState.historyRecords, 'json');
  });

  dom.btnClearLogs.addEventListener('click', async () => {
    await clearAllQuotationRecords();
    appState.historyRecords = [];
    renderTelemetryLogsTable();
  });
}

// Boot
document.addEventListener('DOMContentLoaded', initApp);
