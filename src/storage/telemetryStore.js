/**
 * ============================================================================
 * LogiEngine AI — Camada de Persistência e Histórico (IndexedDB + LocalStorage)
 * ============================================================================
 * Implementa persistência transacional estruturada como tabela SQL
 * (`tb_logistics_quotations`) utilizando IndexedDB com espelhamento síncrono
 * em LocalStorage para inspeção rápida e resiliência.
 *
 * Schema SQL Equivalente:
 * CREATE TABLE tb_logistics_quotations (
 *   transaction_id UUID PRIMARY KEY,
 *   created_at TIMESTAMP NOT NULL,
 *   origin_cep VARCHAR(9) NOT NULL,
 *   destination_cep VARCHAR(9) NOT NULL,
 *   distance_km DECIMAL(5,2) NOT NULL,
 *   weather_condition VARCHAR(40) NOT NULL,
 *   traffic_condition VARCHAR(40) NOT NULL,
 *   courier_demand VARCHAR(40) NOT NULL,
 *   static_price_brl DECIMAL(8,2) NOT NULL,
 *   dynamic_price_brl DECIMAL(8,2) NOT NULL,
 *   surge_multiplier DECIMAL(4,2) NOT NULL,
 *   estimated_sla_minutes INT NOT NULL,
 *   risk_level VARCHAR(16) NOT NULL,
 *   confidence_score DECIMAL(4,2) NOT NULL,
 *   http_status VARCHAR(16) NOT NULL,
 *   latency_ms INT NOT NULL,
 *   model_used VARCHAR(64) NOT NULL,
 *   input_parameters JSONB NOT NULL,
 *   ai_response_payload JSONB NOT NULL
 * );
 */

const DB_NAME = 'LogiEngineAI_TelemetryDB';
const DB_VERSION = 1;
const STORE_NAME = 'tb_logistics_quotations';
const LOCAL_STORAGE_MIRROR_KEY = 'logiengine_sql_tb_logistics_quotations_v1';

/**
 * Abre ou inicializa a conexão com o IndexedDB estruturado.
 * @returns {Promise<IDBDatabase>}
 */
function openTelemetryDatabase() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB indisponível neste navegador.'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = event => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'transaction_id' });
        store.createIndex('idx_created_at', 'created_at', { unique: false });
        store.createIndex('idx_risk_level', 'risk_level', { unique: false });
      }
    };

    request.onsuccess = event => resolve(event.target.result);
    request.onerror = event => reject(event.target.error);
  });
}

/**
 * Lê o espelho do LocalStorage caso o IndexedDB esteja bloqueado ou para boot instantâneo.
 * @returns {Array<Object>}
 */
function readLocalStorageMirror() {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_MIRROR_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Salva o espelho ordenado no LocalStorage (mantendo até 100 registros recentes).
 * @param {Array<Object>} records
 */
function writeLocalStorageMirror(records) {
  try {
    const trimmed = records.slice(0, 100);
    localStorage.setItem(LOCAL_STORAGE_MIRROR_KEY, JSON.stringify(trimmed));
  } catch {
    // Ignora quota exceeded
  }
}

/**
 * Insere uma nova cotação processada na tabela `tb_logistics_quotations`.
 */
export async function insertQuotationRecord({
  inputParameters,
  deterministicData,
  aiPayload,
  executiveSummary,
  telemetry
}) {
  const transactionId =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `tx-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;

  const createdAt = new Date().toISOString();

  const sqlRow = {
    transaction_id: transactionId,
    created_at: createdAt,
    origin_cep: deterministicData.originCep,
    destination_cep: deterministicData.destCep,
    distance_km: deterministicData.distanceKm,
    weight_kg: deterministicData.weightKg,
    volume_category: deterministicData.volumeCategory,
    weather_condition: inputParameters.weather,
    traffic_condition: inputParameters.traffic,
    courier_demand: inputParameters.courierDemand,
    static_price_brl: executiveSummary.staticPriceBrl,
    dynamic_price_brl: executiveSummary.finalDynamicPriceBrl,
    surge_multiplier: aiPayload.surge_multiplier,
    static_sla_minutes: executiveSummary.staticSlaMinutes,
    estimated_sla_minutes: aiPayload.estimated_sla_minutes,
    risk_level: aiPayload.risk_level,
    confidence_score: aiPayload.confidence_score,
    http_status: telemetry.httpStatus || '200 OK',
    latency_ms: telemetry.latencyMs,
    model_used: telemetry.modelUsed,
    execution_mode: telemetry.mode,
    input_parameters: {
      origin_cep: deterministicData.originCep,
      destination_cep: deterministicData.destCep,
      distance_km: deterministicData.distanceKm,
      weight_kg: deterministicData.weightKg,
      volume_category: deterministicData.volumeCategory,
      weather: inputParameters.weather,
      traffic: inputParameters.traffic,
      courier_demand: inputParameters.courierDemand
    },
    ai_response_payload: aiPayload
  };

  // Atualiza espelho em LocalStorage imediatamente
  const existingMirror = readLocalStorageMirror();
  const updatedMirror = [sqlRow, ...existingMirror.filter(r => r.transaction_id !== transactionId)];
  writeLocalStorageMirror(updatedMirror);

  // Persiste no IndexedDB
  try {
    const db = await openTelemetryDatabase();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(sqlRow);
      tx.oncomplete = () => resolve();
      tx.onerror = e => reject(e.target.error);
    });
  } catch (err) {
    console.warn('[TelemetryStore] Fallback para LocalStorage ativo:', err);
  }

  return sqlRow;
}

/**
 * Lista todas as transações armazenadas em ordem decrescente de timestamp.
 * @returns {Promise<Array<Object>>}
 */
export async function listQuotationRecords() {
  try {
    const db = await openTelemetryDatabase();
    const rows = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = e => resolve(e.target.result || []);
      req.onerror = e => reject(e.target.error);
    });

    if (rows.length > 0) {
      rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      writeLocalStorageMirror(rows);
      return rows;
    }
  } catch {
    // Fallback silencioso para LocalStorage
  }

  const mirror = readLocalStorageMirror();
  mirror.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return mirror;
}

/**
 * Remove todos os registros de histórico da tabela local.
 */
export async function clearAllQuotationRecords() {
  localStorage.removeItem(LOCAL_STORAGE_MIRROR_KEY);
  try {
    const db = await openTelemetryDatabase();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.clear();
      tx.oncomplete = () => resolve();
      tx.onerror = e => reject(e.target.error);
    });
  } catch {
    // Ignora erro
  }
}

/**
 * Exporta os registros de telemetria para arquivo JSON ou CSV.
 * @param {Array<Object>} records
 * @param {'json'|'csv'} format
 */
export function exportTelemetryLogs(records, format = 'json') {
  if (!Array.isArray(records) || records.length === 0) return;

  const timestampSlug = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  if (format === 'json') {
    const exportBundle = {
      schema_table: STORE_NAME,
      exported_at: new Date().toISOString(),
      total_records: records.length,
      records
    };
    const blob = new Blob([JSON.stringify(exportBundle, null, 2)], {
      type: 'application/json;charset=utf-8;'
    });
    triggerFileDownload(blob, `logiengine-telemetry-${timestampSlug}.json`);
    return;
  }

  // Exportação CSV estruturada como tabela SQL
  const headers = [
    'transaction_id',
    'created_at',
    'origin_cep',
    'destination_cep',
    'distance_km',
    'weight_kg',
    'volume_category',
    'weather_condition',
    'traffic_condition',
    'courier_demand',
    'static_price_brl',
    'dynamic_price_brl',
    'surge_multiplier',
    'static_sla_minutes',
    'estimated_sla_minutes',
    'risk_level',
    'confidence_score',
    'http_status',
    'latency_ms',
    'model_used',
    'routing_recommendation'
  ];

  const escapeCsvCell = val => {
    const str = val === null || val === undefined ? '' : String(val);
    return `"${str.replace(/"/g, '""')}"`;
  };

  const csvRows = [
    headers.join(','),
    ...records.map(r =>
      [
        r.transaction_id,
        r.created_at,
        r.origin_cep,
        r.destination_cep,
        r.distance_km,
        r.weight_kg,
        r.volume_category,
        r.weather_condition,
        r.traffic_condition,
        r.courier_demand,
        r.static_price_brl,
        r.dynamic_price_brl,
        r.surge_multiplier,
        r.static_sla_minutes,
        r.estimated_sla_minutes,
        r.risk_level,
        r.confidence_score,
        r.http_status,
        r.latency_ms,
        r.model_used,
        r.ai_response_payload?.routing_recommendation || ''
      ]
        .map(escapeCsvCell)
        .join(',')
    )
  ];

  const blob = new Blob(['\uFEFF' + csvRows.join('\n')], {
    type: 'text/csv;charset=utf-8;'
  });
  triggerFileDownload(blob, `logiengine-telemetry-${timestampSlug}.csv`);
}

function triggerFileDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
