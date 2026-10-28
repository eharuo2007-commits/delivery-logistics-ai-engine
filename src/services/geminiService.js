/**
 * ============================================================================
 * LogiEngine AI — Camada de Inteligência (Google Gemini API Service & Schema)
 * ============================================================================
 * Implementa a chamada oficial ao Google Gemini API via Interactions API
 * (`v1beta/interactions`) usando Structured Outputs (`response_format` com
 * JSON Schema estrito) e o modelo atual `gemini-3.8-flash` (substituto direto
 * do legado `gemini-2.5-flash`).
 *
 * Também fornece um motor de simulação/fallback de alta fidelidade (Mock Mode)
 * caso a API Key não seja informada ou o usuário deseje testar offline.
 */

export const GEMINI_MODEL_CONFIG = Object.freeze({
  ACTIVE_MODEL: 'gemini-3.8-flash',
  DISPLAY_SPEC_LABEL: 'gemini-3.8-flash (Active SDK / Legacy Spec: gemini-2.5-flash)',
  INTERACTIONS_ENDPOINT: 'https://generativelanguage.googleapis.com/v1beta/interactions',
  API_REVISION: '2026-05-20'
});

/**
 * Contrato JSON Schema estrito exigido para a resposta do Gemini API.
 */
export const LOGIENGINE_RESPONSE_JSON_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    surge_multiplier: {
      type: 'number',
      description: 'Multiplicador de precificação dinâmica (Surge Pricing) entre 1.0 e 2.5.'
    },
    estimated_sla_minutes: {
      type: 'integer',
      description: 'Tempo total estimado de entrega (SLA) em minutos inteiros.'
    },
    risk_level: {
      type: 'string',
      enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
      description: 'Classificação de risco operacional e logístico da rota.'
    },
    bottleneck_factors: {
      type: 'array',
      items: { type: 'string' },
      description: 'Lista de fatores técnicos de gargalo que impactam o SLA e o preço.'
    },
    routing_recommendation: {
      type: 'string',
      description: 'Decisão técnica recomendada para alocação de modal/entregador e despacho.'
    },
    confidence_score: {
      type: 'number',
      description: 'Score de confiança da inferência preditiva entre 0.0 e 1.0.'
    }
  },
  required: [
    'surge_multiplier',
    'estimated_sla_minutes',
    'risk_level',
    'bottleneck_factors',
    'routing_recommendation',
    'confidence_score'
  ]
});

/**
 * System Prompt de Engenharia Logística embutido na chamada do LLM.
 */
export const LOGIENGINE_SYSTEM_INSTRUCTION = `Você é o LogiEngine AI, um motor especialista de Precificação Dinâmica (Surge Pricing), Roteirização de Última Milha (Last-Mile Delivery) e Previsão de SLA Logístico em tempo real para operações de alta escala (padrão iFood).

Sua missão é analisar variáveis determinísticas da rota (CEPs, distância em km, peso, volume, SLA estático base) combinadas com variáveis estocásticas de contexto (Clima, Tráfego e Balanço de Oferta/Demanda de Entregadores) e retornar ESTRITAMENTE um objeto JSON válido seguindo o schema fornecido:
{
  "surge_multiplier": float (entre 1.0 e 2.5),
  "estimated_sla_minutes": int,
  "risk_level": "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
  "bottleneck_factors": [array de strings com fatores de impacto],
  "routing_recommendation": string (decisão técnica para alocação de entregador),
  "confidence_score": float (0.0 a 1.0)
}

DIRETRIZES TÉCNICAS DE CALIBRAÇÃO:
1. "surge_multiplier": Deve estar estritamente entre 1.0 e 2.5. Condições nominais ("Céu Limpo", "Normal", "Alta Oferta" ou "Equilibrado") devem ficar entre 1.00 e 1.15. Condições severas ("Tempestade Severa", "Acidente na Via", "Escassez Crítica") devem escalar entre 1.75 e 2.50.
2. "estimated_sla_minutes": Deve partir do SLA estático base informado e adicionar penalidades realistas de trânsito, intempéries climáticas e tempo de pareamento com entregador.
3. "risk_level": Use "LOW", "MEDIUM", "HIGH" ou "CRITICAL" de forma coerente com a severidade operacional.
4. "bottleneck_factors": Liste de 2 a 4 fatores técnicos objetivos em português (ex: "Retenção severa por acidente viário no corredor principal", "Déficit agudo de entregadores ativos no cluster de origem").
5. "routing_recommendation": Forneça uma recomendação executiva acionável para o sistema de despacho (ex: modal sugerido moto/bike/carro, raio de busca, bônus de incentivo, batching proibido ou recomendado).
6. "confidence_score": Float entre 0.0 e 1.0 refletindo a previsibilidade da malha no cenário atual.`;

/**
 * Constrói o prompt estruturado de entrada do turno para a inferência.
 */
export function buildLogisticsUserPrompt(contextPayload, deterministicData) {
  return JSON.stringify(
    {
      task: 'EVALUATE_DYNAMIC_FREIGHT_AND_SLA',
      route_parameters: {
        origin_cep: deterministicData.originCep,
        origin_region: deterministicData.originRegion,
        destination_cep: deterministicData.destCep,
        destination_region: deterministicData.destRegion,
        distance_km: deterministicData.distanceKm,
        package_weight_kg: deterministicData.weightKg,
        package_volume_tier: deterministicData.volumeCategory,
        static_base_price_brl: deterministicData.baseTotalBrl,
        static_baseline_sla_minutes: deterministicData.staticSlaMinutes
      },
      real_time_telemetry: {
        weather_condition: contextPayload.weather,
        traffic_condition: contextPayload.traffic,
        courier_supply_demand: contextPayload.courierDemand,
        timestamp_iso: new Date().toISOString()
      }
    },
    null,
    2
  );
}

/**
 * Valida e higieniza o JSON retornado pelo modelo para garantir 100% de
 * conformidade com o contrato de domínio.
 */
export function validateAndSanitizeAiOutput(rawJson) {
  const validRisks = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
  const rawMultiplier = Number(rawJson?.surge_multiplier);
  const surge_multiplier = Number.isFinite(rawMultiplier)
    ? Number(Math.min(2.5, Math.max(1.0, rawMultiplier)).toFixed(2))
    : 1.0;

  const rawSla = parseInt(rawJson?.estimated_sla_minutes, 10);
  const estimated_sla_minutes = Number.isFinite(rawSla) && rawSla > 0 ? rawSla : 25;

  const candidateRisk = String(rawJson?.risk_level || 'LOW').toUpperCase();
  const risk_level = validRisks.includes(candidateRisk) ? candidateRisk : 'MEDIUM';

  const bottleneck_factors = Array.isArray(rawJson?.bottleneck_factors) && rawJson.bottleneck_factors.length > 0
    ? rawJson.bottleneck_factors.map(item => String(item))
    : ['Condições operacionais nominais na malha urbana'];

  const routing_recommendation = String(
    rawJson?.routing_recommendation ||
      'Alocação automática em frota dedicada num raio de 1.5km do ponto de coleta.'
  );

  const rawConfidence = Number(rawJson?.confidence_score);
  const confidence_score = Number.isFinite(rawConfidence)
    ? Number(Math.min(1.0, Math.max(0.0, rawConfidence)).toFixed(2))
    : 0.92;

  return {
    surge_multiplier,
    estimated_sla_minutes,
    risk_level,
    bottleneck_factors,
    routing_recommendation,
    confidence_score
  };
}

/**
 * Motor de Inferência Simulada Realista (Mock Engine Determinístico + Heurístico)
 * Usado quando nenhuma Gemini API Key é preenchida ou em modo de simulação.
 */
export async function runRealisticMockInference(contextPayload, deterministicData) {
  const startPerf = performance.now();

  // Simula latência realista de rede de microsserviço LLM (140ms a 310ms)
  const simulatedWaitMs = 155 + Math.floor(Math.random() * 130);
  await new Promise(resolve => setTimeout(resolve, simulatedWaitMs));

  let multiplier = 1.0;
  let slaPenaltyFactor = 1.0;
  let slaFlatAdditionMin = 0;
  let riskScore = 0;
  const bottlenecks = [];

  // 1. Impacto Climático
  switch (contextPayload.weather) {
    case 'Tempestade Severa':
      multiplier += 0.58;
      slaPenaltyFactor += 0.42;
      slaFlatAdditionMin += 11;
      riskScore += 3;
      bottlenecks.push(
        'Tempestade severa reduz velocidade média da frota em ~38% e eleva risco de alagamento'
      );
      break;
    case 'Chuva Moderada':
      multiplier += 0.24;
      slaPenaltyFactor += 0.18;
      slaFlatAdditionMin += 5;
      riskScore += 1.5;
      bottlenecks.push(
        'Pista molhada (Chuva Moderada) reduz aderência e exige margem de segurança no SLA'
      );
      break;
    default:
      // Céu Limpo
      bottlenecks.push('Visibilidade e condições meteorológicas ideais (Céu Limpo)');
      break;
  }

  // 2. Impacto de Tráfego
  switch (contextPayload.traffic) {
    case 'Acidente na Via':
      multiplier += 0.44;
      slaPenaltyFactor += 0.46;
      slaFlatAdditionMin += 13;
      riskScore += 3;
      bottlenecks.push(
        `Retenção crítica por Acidente na Via no corredor ${deterministicData.originRegion} -> ${deterministicData.destRegion}`
      );
      break;
    case 'Horário de Pico':
      multiplier += 0.26;
      slaPenaltyFactor += 0.25;
      slaFlatAdditionMin += 6;
      riskScore += 1.5;
      bottlenecks.push(
        'Saturação viária de Horário de Pico nos cruzamentos arteriais da rota'
      );
      break;
    default:
      bottlenecks.push('Fluxo viário normalizado nos corredores principais');
      break;
  }

  // 3. Impacto de Oferta/Demanda de Entregadores
  switch (contextPayload.courierDemand) {
    case 'Escassez Crítica':
      multiplier += 0.52;
      slaFlatAdditionMin += 10;
      riskScore += 2.5;
      bottlenecks.push(
        `Escassez Crítica de entregadores ativos no cluster ${deterministicData.originRegion} (+10 min no pareamento)`
      );
      break;
    case 'Equilibrado':
      multiplier += 0.06;
      slaFlatAdditionMin += 2;
      riskScore += 0.5;
      break;
    case 'Alta Oferta':
      multiplier -= 0.04;
      slaFlatAdditionMin -= 1;
      bottlenecks.push('Alta disponibilidade de entregadores no raio de 800m da coleta');
      break;
  }

  // 4. Impacto de Distância Longa e Peso/Volume
  if (deterministicData.distanceKm >= 10) {
    multiplier += 0.18;
    slaPenaltyFactor += 0.12;
    riskScore += 1.2;
    bottlenecks.push(
      `Rota inter-zonal longa (${deterministicData.distanceKm} km) exige retorno assistido para o parceiro`
    );
  } else if (deterministicData.distanceKm >= 6) {
    multiplier += 0.07;
    riskScore += 0.4;
  }

  if (deterministicData.volumeCategory === 'LARGE' || deterministicData.weightKg > 5) {
    multiplier += 0.12;
    slaFlatAdditionMin += 4;
    riskScore += 0.8;
    bottlenecks.push(
      `Carga volumosa/pesada (${deterministicData.weightKg}kg / ${deterministicData.volumeCategory}) restringe modal elegível`
    );
  }

  const finalMultiplier = Number(Math.min(2.5, Math.max(1.0, multiplier)).toFixed(2));
  const estimatedSla = Math.max(
    12,
    Math.round(deterministicData.staticSlaMinutes * slaPenaltyFactor + slaFlatAdditionMin)
  );

  // Classificação de Risco
  let riskLevel = 'LOW';
  if (riskScore >= 6.0 || finalMultiplier >= 2.05) {
    riskLevel = 'CRITICAL';
  } else if (riskScore >= 3.5 || finalMultiplier >= 1.55) {
    riskLevel = 'HIGH';
  } else if (riskScore >= 1.5 || finalMultiplier >= 1.2) {
    riskLevel = 'MEDIUM';
  }

  // Recomendação Técnica de Roteirização e Alocação
  let routingRecommendation = '';
  if (riskLevel === 'CRITICAL') {
    routingRecommendation =
      'DESPACHO PRIORITÁRIO NÍVEL 1: Bloquear pedido duplo (No-Batching), expandir raio de busca para 3.5km, ativar bônus dinâmico imediato para Motofrete Experiente (Score > 4.8) e redirecionar rota evitando vias arteriais bloqueadas.';
  } else if (riskLevel === 'HIGH') {
    routingRecommendation =
      'ALOCAÇÃO DEDICADA ASSISTIDA: Priorizar modal Motocicleta 150cc+ ou Utilitário Leve (se carga grande), desativar agrupamento de rotas longas e pré-alocar entregador antes da finalização do preparo.';
  } else if (riskLevel === 'MEDIUM') {
    routingRecommendation =
      'ROTEIRIZAÇÃO OTIMIZADA: Alocar entregador em raio de até 1.8km; permitir agrupamento (Smart Batching) apenas com pedidos de mesmo sentido viário (< 600m de desvio).';
  } else {
    routingRecommendation =
      'OPERAÇÃO NOMINAL EFICIENTE: Alocação padrão no pool local (Raio <= 1.0km). Elegível para E-Bike/Moto em curta distância e Smart Batching otimizado para redução de custo por entrega.';
  }

  // Score de Confiança inversamente proporcional à volatilidade extrema
  const rawConfidence = 0.96 - riskScore * 0.024;
  const confidenceScore = Number(Math.min(0.98, Math.max(0.74, rawConfidence)).toFixed(2));

  const payload = validateAndSanitizeAiOutput({
    surge_multiplier: finalMultiplier,
    estimated_sla_minutes: estimatedSla,
    risk_level: riskLevel,
    bottleneck_factors: bottlenecks.slice(0, 4),
    routing_recommendation: routingRecommendation,
    confidence_score: confidenceScore
  });

  const latencyMs = Math.round(performance.now() - startPerf);

  return {
    payload,
    telemetry: {
      httpStatus: '200 OK',
      httpCode: 200,
      latencyMs,
      modelUsed: `${GEMINI_MODEL_CONFIG.ACTIVE_MODEL} (Simulação Determinística)`,
      mode: 'MOCK_SIMULATION',
      interactionId: `sim_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`
    }
  };
}

/**
 * Executa a inferência no Google Gemini API (Interactions API c/ Structured Outputs)
 * ou aciona o motor Mock caso a chave não seja fornecida.
 */
export async function executeLogisticsInference({
  apiKey,
  forceMock = false,
  contextPayload,
  deterministicData
}) {
  const cleanKey = String(apiKey || '').trim();

  if (!cleanKey || forceMock) {
    return runRealisticMockInference(contextPayload, deterministicData);
  }

  const startPerf = performance.now();
  const userPrompt = buildLogisticsUserPrompt(contextPayload, deterministicData);

  const requestBody = {
    model: GEMINI_MODEL_CONFIG.ACTIVE_MODEL,
    system_instruction: LOGIENGINE_SYSTEM_INSTRUCTION,
    input: userPrompt,
    response_format: {
      type: 'text',
      mime_type: 'application/json',
      schema: LOGIENGINE_RESPONSE_JSON_SCHEMA
    },
    generation_config: {
      temperature: 0.2
    }
  };

  const response = await fetch(GEMINI_MODEL_CONFIG.INTERACTIONS_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': cleanKey,
      'Api-Revision': GEMINI_MODEL_CONFIG.API_REVISION
    },
    body: JSON.stringify(requestBody)
  });

  const latencyMs = Math.round(performance.now() - startPerf);

  if (!response.ok) {
    let errorDetail = `HTTP ${response.status}`;
    try {
      const errJson = await response.json();
      errorDetail = errJson?.error?.message || JSON.stringify(errJson);
    } catch {
      // ignora erro de parse
    }
    const error = new Error(`Falha na chamada Gemini API (${response.status}): ${errorDetail}`);
    error.httpCode = response.status;
    error.latencyMs = latencyMs;
    throw error;
  }

  const interactionData = await response.json();

  // Extrai o texto JSON da estrutura oficial do Interactions API (`output_text` ou `steps`)
  let rawOutputText = interactionData?.output_text;
  if (!rawOutputText && Array.isArray(interactionData?.steps)) {
    for (let i = interactionData.steps.length - 1; i >= 0; i--) {
      const step = interactionData.steps[i];
      if (step?.type === 'model_output' && Array.isArray(step.content)) {
        const textPart = step.content.find(c => c.type === 'text' && c.text);
        if (textPart) {
          rawOutputText = textPart.text;
          break;
        }
      }
    }
  }

  if (!rawOutputText) {
    throw new Error('A resposta da Gemini API não retornou conteúdo JSON estruturado.');
  }

  const parsedJson = JSON.parse(rawOutputText);
  const sanitizedPayload = validateAndSanitizeAiOutput(parsedJson);

  return {
    payload: sanitizedPayload,
    telemetry: {
      httpStatus: `${response.status} OK`,
      httpCode: response.status,
      latencyMs,
      modelUsed: interactionData?.model || GEMINI_MODEL_CONFIG.ACTIVE_MODEL,
      mode: 'LIVE_GEMINI_API',
      interactionId: interactionData?.id || `live_${crypto.randomUUID().slice(0, 12)}`,
      tokenUsage: interactionData?.usage?.total_tokens || null
    }
  };
}
