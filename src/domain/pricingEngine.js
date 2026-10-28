/**
 * ============================================================================
 * LogiEngine AI — Camada de Domínio (Regras Determinísticas & Haversine/CEP)
 * ============================================================================
 * Responsável pelo cálculo determinístico de distância base entre CEPs,
 * tarifas por quilômetro (R$ 1,80/km), adicionais de peso/volume e SLA base
 * estático (para comparação A/B com o motor dinâmico de IA).
 */

export const PRICING_CONSTANTS = Object.freeze({
  BASE_FIXED_FEE_BRL: 4.50,       // Taxa fixa mínima de coleta (R$)
  RATE_PER_KM_BRL: 1.80,          // Taxa determinística por km (R$ 1,80/km)
  WEIGHT_FREE_LIMIT_KG: 3.0,      // Franquia de peso isenta (até 3kg)
  EXTRA_WEIGHT_PER_KG_BRL: 0.85,  // Adicional por kg excedente (R$/kg)
  VOLUME_MULTIPLIERS: {
    SMALL: { label: 'Pequeno (Mochila Padrão)', addonBrl: 0.00, factor: 1.0 },
    MEDIUM: { label: 'Médio (Bag Térmica 45L)', addonBrl: 2.20, factor: 1.08 },
    LARGE: { label: 'Grande (Baú / Carga Pesada)', addonBrl: 5.90, factor: 1.22 }
  },
  BASE_SPEED_KMH: 26.0,           // Velocidade média urbana base (km/h)
  HANDLING_BUFFER_MINUTES: 10     // Tempo base de coleta + despacho (min)
});

/**
 * Mapa geográfico de prefixos de CEP (SP e grandes centros) com coordenadas
 * aproximadas para cálculo determinístico realista caso o usuário altere o CEP.
 */
const CEP_GEO_ANCHORS = [
  { prefix: '010', region: 'Centro Histórico - SP', lat: -23.5489, lng: -46.6388 },
  { prefix: '013', region: 'Bela Vista / Paulista - SP', lat: -23.5614, lng: -46.6559 },
  { prefix: '014', region: 'Jardins - SP', lat: -23.5672, lng: -46.6682 },
  { prefix: '040', region: 'Vila Mariana / Moema - SP', lat: -23.5891, lng: -46.6347 },
  { prefix: '045', region: 'Itaim Bibi / Vila Olímpia - SP', lat: -23.5912, lng: -46.6829 },
  { prefix: '047', region: 'Santo Amaro / Brooklin - SP', lat: -23.6275, lng: -46.6978 },
  { prefix: '050', region: 'Perdizes / Barra Funda - SP', lat: -23.5322, lng: -46.6798 },
  { prefix: '054', region: 'Pinheiros / Vila Madalena - SP', lat: -23.5617, lng: -46.6915 },
  { prefix: '060', region: 'Osasco (Hub iFood) - SP', lat: -23.5329, lng: -46.7916 },
  { prefix: '080', region: 'Zona Leste / São Miguel - SP', lat: -23.4975, lng: -46.4421 },
  { prefix: '090', region: 'Santo André / ABC - SP', lat: -23.6639, lng: -46.5383 }
];

/**
 * Normaliza e formata uma string de CEP para o padrão XXXXX-XXX.
 * @param {string} rawCep
 * @returns {string}
 */
export function formatCep(rawCep) {
  const digits = String(rawCep || '').replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

/**
 * Converte um CEP em coordenadas geográficas determinísticas e nome de região.
 * @param {string} cep
 * @returns {{ lat: number, lng: number, region: string }}
 */
export function resolveCepGeo(cep) {
  const digits = String(cep || '').replace(/\D/g, '').padEnd(8, '0');
  const prefix3 = digits.slice(0, 3);
  const anchor = CEP_GEO_ANCHORS.find(a => a.prefix === prefix3);

  // Hash determinístico dos últimos 5 dígitos para micro-variação de rua
  const suffixNum = parseInt(digits.slice(3, 8), 10) || 12345;
  const latOffset = ((suffixNum % 1000) - 500) * 0.000045;
  const lngOffset = (((Math.floor(suffixNum / 100)) % 1000) - 500) * 0.000045;

  if (anchor) {
    return {
      lat: anchor.lat + latOffset,
      lng: anchor.lng + lngOffset,
      region: anchor.region
    };
  }

  // Fallback determinístico para qualquer CEP do Brasil
  const macroSeed = parseInt(digits.slice(0, 5), 10) || 10000;
  return {
    lat: -23.5505 + ((macroSeed % 400) - 200) * 0.0006 + latOffset,
    lng: -46.6333 + (((macroSeed * 7) % 400) - 200) * 0.0006 + lngOffset,
    region: `Setor Urbano CEP ${digits.slice(0, 5)}`
  };
}

/**
 * Calcula a distância rodoviária simulada em km entre dois CEPs usando
 * Haversine + fator de tortuosidade viária urbana (1.34x).
 * @param {string} originCep
 * @param {string} destCep
 * @returns {{ distanceKm: number, originRegion: string, destRegion: string }}
 */
export function estimateRouteDistanceFromCeps(originCep, destCep) {
  const cleanOrigin = String(originCep || '').replace(/\D/g, '');
  const cleanDest = String(destCep || '').replace(/\D/g, '');

  const originGeo = resolveCepGeo(cleanOrigin);
  const destGeo = resolveCepGeo(cleanDest);

  if (cleanOrigin === cleanDest && cleanOrigin.length === 8) {
    return {
      distanceKm: 1.2,
      originRegion: originGeo.region,
      destRegion: destGeo.region
    };
  }

  const R = 6371; // Raio da Terra em km
  const dLat = ((destGeo.lat - originGeo.lat) * Math.PI) / 180;
  const dLng = ((destGeo.lng - originGeo.lng) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((originGeo.lat * Math.PI) / 180) *
      Math.cos((destGeo.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const straightDistance = R * c;

  // Fator de tortuosidade viária urbana (1.34x) com limites operacionais
  const roadDistance = Math.max(1.2, Math.min(42.0, straightDistance * 1.34));

  return {
    distanceKm: Number(roadDistance.toFixed(1)),
    originRegion: originGeo.region,
    destRegion: destGeo.region
  };
}

/**
 * Executa o cálculo determinístico da camada de domínio (Regras Estáticas).
 * @param {Object} params
 * @param {string} params.originCep
 * @param {string} params.destCep
 * @param {number} params.distanceKm
 * @param {number} [params.weightKg=1.8]
 * @param {'SMALL'|'MEDIUM'|'LARGE'} [params.volumeCategory='SMALL']
 */
export function calculateDeterministicPricing({
  originCep,
  destCep,
  distanceKm,
  weightKg = 1.8,
  volumeCategory = 'SMALL'
}) {
  const validDistance = Math.max(0.5, Number(distanceKm) || 1.0);
  const validWeight = Math.max(0.1, Number(weightKg) || 1.0);
  const volumeSpec =
    PRICING_CONSTANTS.VOLUME_MULTIPLIERS[volumeCategory] ||
    PRICING_CONSTANTS.VOLUME_MULTIPLIERS.SMALL;

  // 1. Parcela por quilometragem (R$ 1,80/km)
  const distanceCostBrl = validDistance * PRICING_CONSTANTS.RATE_PER_KM_BRL;

  // 2. Adicional de peso/volume
  const extraWeightKg = Math.max(0, validWeight - PRICING_CONSTANTS.WEIGHT_FREE_LIMIT_KG);
  const weightAddonBrl = extraWeightKg * PRICING_CONSTANTS.EXTRA_WEIGHT_PER_KG_BRL;
  const volumeAddonBrl = volumeSpec.addonBrl;
  const totalWeightVolumeAddonBrl = Number((weightAddonBrl + volumeAddonBrl).toFixed(2));

  // 3. Taxa Base Determinística (Taxa Fixa + Distância + Peso/Volume)
  const baseTotalBrl = Number(
    (
      PRICING_CONSTANTS.BASE_FIXED_FEE_BRL +
      distanceCostBrl +
      totalWeightVolumeAddonBrl
    ).toFixed(2)
  );

  // 4. SLA Estático Tradicional (ignora clima severo, acidentes ou escassez de frota)
  const travelMinutes = (validDistance / PRICING_CONSTANTS.BASE_SPEED_KMH) * 60;
  const staticSlaMinutes = Math.round(
    PRICING_CONSTANTS.HANDLING_BUFFER_MINUTES + travelMinutes * volumeSpec.factor
  );

  const geoInfo = estimateRouteDistanceFromCeps(originCep, destCep);

  return {
    originCep: formatCep(originCep),
    destCep: formatCep(destCep),
    originRegion: geoInfo.originRegion,
    destRegion: geoInfo.destRegion,
    distanceKm: Number(validDistance.toFixed(1)),
    weightKg: Number(validWeight.toFixed(1)),
    volumeCategory,
    volumeLabel: volumeSpec.label,
    ratePerKmBrl: PRICING_CONSTANTS.RATE_PER_KM_BRL,
    fixedFeeBrl: PRICING_CONSTANTS.BASE_FIXED_FEE_BRL,
    distanceCostBrl: Number(distanceCostBrl.toFixed(2)),
    weightAddonBrl: Number(weightAddonBrl.toFixed(2)),
    volumeAddonBrl: Number(volumeAddonBrl.toFixed(2)),
    totalWeightVolumeAddonBrl,
    baseTotalBrl,
    staticSlaMinutes
  };
}

/**
 * Combina o resultado determinístico com a resposta estruturada da IA
 * para produzir a cotação executiva final e o comparativo A/B.
 */
export function combineDeterministicAndAiPricing(deterministicResult, aiOutput) {
  const surgeMultiplier = Number(
    Math.min(2.5, Math.max(1.0, Number(aiOutput.surge_multiplier) || 1.0)).toFixed(2)
  );

  const finalDynamicPriceBrl = Number(
    (deterministicResult.baseTotalBrl * surgeMultiplier).toFixed(2)
  );

  const surgeDeltaBrl = Number(
    (finalDynamicPriceBrl - deterministicResult.baseTotalBrl).toFixed(2)
  );

  const slaDeltaMinutes =
    Number(aiOutput.estimated_sla_minutes) - deterministicResult.staticSlaMinutes;

  return {
    deterministic: deterministicResult,
    ai: {
      surge_multiplier: surgeMultiplier,
      estimated_sla_minutes: Math.round(Number(aiOutput.estimated_sla_minutes) || deterministicResult.staticSlaMinutes),
      risk_level: aiOutput.risk_level || 'LOW',
      bottleneck_factors: Array.isArray(aiOutput.bottleneck_factors)
        ? aiOutput.bottleneck_factors
        : [],
      routing_recommendation:
        aiOutput.routing_recommendation ||
        'Alocação padrão na malha logística disponível.',
      confidence_score: Number(
        Math.min(1.0, Math.max(0.0, Number(aiOutput.confidence_score) || 0.9)).toFixed(2)
      )
    },
    executiveSummary: {
      finalDynamicPriceBrl,
      staticPriceBrl: deterministicResult.baseTotalBrl,
      surgeDeltaBrl,
      surgePercentage: Math.round((surgeMultiplier - 1) * 100),
      dynamicSlaMinutes: Math.round(Number(aiOutput.estimated_sla_minutes)),
      staticSlaMinutes: deterministicResult.staticSlaMinutes,
      slaDeltaMinutes
    }
  };
}

/**
 * Presets Rápidos de Cenários Operacionais (1-Click Testing)
 */
export const SCENARIO_PRESETS = Object.freeze({
  NORMAL_LUNCH: {
    id: 'NORMAL_LUNCH',
    name: 'Cenário Normal (Almoço)',
    badge: 'Operação Nominal',
    originCep: '01310-100',
    destCep: '04001-001',
    distanceKm: 4.2,
    weightKg: 1.5,
    volumeCategory: 'SMALL',
    weather: 'Céu Limpo',
    traffic: 'Normal',
    courierDemand: 'Equilibrado'
  },
  CRITICAL_STORM_FRIDAY: {
    id: 'CRITICAL_STORM_FRIDAY',
    name: 'Cenário Crítico (Tempestade + Sexta à Noite)',
    badge: 'Stress Test / Surge Alto',
    originCep: '04538-132',
    destCep: '05424-000',
    distanceKm: 6.8,
    weightKg: 4.5,
    volumeCategory: 'MEDIUM',
    weather: 'Tempestade Severa',
    traffic: 'Acidente na Via',
    courierDemand: 'Escassez Crítica'
  },
  LONG_ROUTE_HIGH_DEMAND: {
    id: 'LONG_ROUTE_HIGH_DEMAND',
    name: 'Rota Longa (Alta Demanda)',
    badge: 'Inter-Zonas / Horário de Pico',
    originCep: '06020-194',
    destCep: '04719-001',
    distanceKm: 14.6,
    weightKg: 6.2,
    volumeCategory: 'LARGE',
    weather: 'Chuva Moderada',
    traffic: 'Horário de Pico',
    courierDemand: 'Escassez Crítica'
  }
});
