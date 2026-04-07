/**
 * smart-alerts.ts — ParentOS 智能预警引擎
 *
 * 三个核心机制：
 * 1. 标签碰撞拦截器 — 交叉比对过敏原与疫苗/食物任务的风险标签
 * 2. 事件驱动动态任务 — 保存高优过敏事件后自动插入追踪任务
 * 3. 周期性条件预警 — 基于季节/慢性过敏档案下发防御性提醒
 */

import type { ActiveReminder } from './reminder-engine.js';

/* ================================================================
   1. DATA STRUCTURES
   ================================================================ */

/** Child's allergy profile — extracted from allergy_records + children.allergies */
export interface AllergyProfile {
  /** Normalized allergen tags: e.g. ['egg', 'milk', 'peanut', 'dust-mite'] */
  allergenTags: string[];
  /** Active allergy categories */
  activeCategories: Set<string>;
  /** Has severe reaction history */
  hasSevereHistory: boolean;
  /** Chronic conditions (for seasonal alerts) */
  chronicConditions: string[]; // e.g. ['pollen-allergy', 'rhinitis', 'eczema']
}

/** Enhanced reminder with optional allergy warning */
export interface EnhancedReminder extends ActiveReminder {
  /** If set, this reminder has an allergy collision warning */
  allergyWarning?: {
    level: 'caution' | 'warning' | 'danger';
    message: string;
    matchedAllergens: string[];
  };
}

/** Dynamic follow-up task generated from events */
export interface DynamicTask {
  id: string;
  childId: string;
  title: string;
  description: string;
  triggerDate: string; // ISO date when to show
  domain: string;
  priority: 'P0' | 'P1' | 'P2';
  source: 'allergy-followup' | 'dental-followup' | 'seasonal-alert';
  linkedRecordId?: string;
}

/** Seasonal alert definition */
export interface SeasonalAlert {
  id: string;
  title: string;
  description: string;
  /** Months when this alert is active (1-12) */
  activeMonths: number[];
  /** Required chronic conditions to trigger */
  requiredConditions: string[];
  priority: 'P1' | 'P2';
}

/* ================================================================
   2. ALLERGEN TAG MAPPING
   ================================================================ */

/**
 * Maps common allergen names (Chinese + English) to normalized tags.
 * Used to match child's allergy profile against reminder rule tags.
 */
const ALLERGEN_NORMALIZE: Record<string, string[]> = {
  // Food allergens
  '鸡蛋': ['egg'], '蛋': ['egg'], '蛋白': ['egg'], 'egg': ['egg'],
  '牛奶': ['milk', 'dairy'], '乳制品': ['milk', 'dairy'], '奶': ['milk'], 'milk': ['milk'],
  '花生': ['peanut'], 'peanut': ['peanut'],
  '坚果': ['tree-nut'], '杏仁': ['tree-nut'], '核桃': ['tree-nut'],
  '大豆': ['soy'], '黄豆': ['soy'], 'soy': ['soy'],
  '小麦': ['wheat', 'gluten'], '面粉': ['wheat', 'gluten'], '麸质': ['gluten'],
  '海鲜': ['seafood', 'shellfish'], '虾': ['seafood', 'shellfish'], '蟹': ['seafood', 'shellfish'],
  '鱼': ['fish'], '鱼类': ['fish'],
  // Environmental
  '尘螨': ['dust-mite'], '螨虫': ['dust-mite'],
  '花粉': ['pollen'], '柳絮': ['pollen'], '杨絮': ['pollen'],
  '霉菌': ['mold'], '真菌': ['mold'],
  '猫毛': ['pet-dander'], '狗毛': ['pet-dander'], '动物皮屑': ['pet-dander'],
  // Drug
  '青霉素': ['penicillin'], '阿莫西林': ['penicillin', 'amoxicillin'],
  '头孢': ['cephalosporin'], '磺胺': ['sulfonamide'],
};

/**
 * Maps reminder rule tags to related allergen tags.
 * E.g., flu vaccine contains egg protein → tag 'egg' is a risk.
 */
const RULE_TAG_ALLERGEN_MAP: Record<string, string[]> = {
  // Vaccine-related
  'influenza': ['egg'],        // 流感疫苗含鸡蛋蛋白
  'flu': ['egg'],
  'mmr': ['egg'],              // 麻腮风疫苗含微量鸡蛋蛋白
  'yellow-fever': ['egg'],     // 黄热病疫苗
  // General
  'gelatin': ['gelatin'],      // 某些疫苗含明胶
  'neomycin': ['neomycin'],    // 某些疫苗含新霉素
};

/* ================================================================
   3. TAG COLLISION INTERCEPTOR
   ================================================================ */

/**
 * Normalize a free-text allergen string into standard tags.
 */
export function normalizeAllergen(allergen: string): string[] {
  const lower = allergen.toLowerCase().trim();
  const tags: string[] = [];
  for (const [key, mapped] of Object.entries(ALLERGEN_NORMALIZE)) {
    if (lower.includes(key.toLowerCase())) {
      tags.push(...mapped);
    }
  }
  // If no match, use the raw string as a tag
  if (tags.length === 0) tags.push(lower);
  return [...new Set(tags)];
}

/**
 * Build an AllergyProfile from raw allergy data.
 */
export function buildAllergyProfile(
  allergies: string[] | null,
  allergyRecords: Array<{ allergen: string; category: string; severity: string; status: string; notes: string | null }>,
): AllergyProfile {
  const tagSet = new Set<string>();
  const categories = new Set<string>();
  let hasSevere = false;
  const chronic: string[] = [];

  // From children.allergies (simple string array)
  if (allergies) {
    for (const a of allergies) {
      for (const t of normalizeAllergen(a)) tagSet.add(t);
    }
  }

  // From structured allergy_records
  for (const rec of allergyRecords) {
    if (rec.status !== 'active') continue;
    for (const t of normalizeAllergen(rec.allergen)) tagSet.add(t);
    categories.add(rec.category);
    if (rec.severity === 'severe') hasSevere = true;

    // Detect chronic conditions
    const lower = rec.allergen.toLowerCase();
    if (lower.includes('花粉') || lower.includes('pollen')) chronic.push('pollen-allergy');
    if (lower.includes('鼻炎') || lower.includes('rhinitis')) chronic.push('rhinitis');
    if (lower.includes('湿疹') || lower.includes('eczema')) chronic.push('eczema');
    if (lower.includes('哮喘') || lower.includes('asthma')) chronic.push('asthma');
    if (rec.notes?.includes('季节性')) chronic.push('seasonal');
  }

  return {
    allergenTags: [...tagSet],
    activeCategories: categories,
    hasSevereHistory: hasSevere,
    chronicConditions: [...new Set(chronic)],
  };
}

/**
 * INTERCEPTOR: Enhance reminders with allergy collision warnings.
 *
 * For each active reminder, checks if its tags overlap with the child's
 * allergy profile. If so, attaches a warning to the reminder.
 */
export function interceptAllergyCollisions(
  reminders: ActiveReminder[],
  profile: AllergyProfile,
): EnhancedReminder[] {
  if (profile.allergenTags.length === 0) {
    return reminders; // No allergies, pass through
  }

  const allergenSet = new Set(profile.allergenTags);

  return reminders.map((reminder): EnhancedReminder => {
    const ruleTags = reminder.rule.tags ?? [];
    const matched: string[] = [];

    for (const tag of ruleTags) {
      // Direct tag match
      if (allergenSet.has(tag)) {
        matched.push(tag);
      }
      // Indirect match via rule-tag-to-allergen map
      const relatedAllergens = RULE_TAG_ALLERGEN_MAP[tag];
      if (relatedAllergens) {
        for (const ra of relatedAllergens) {
          if (allergenSet.has(ra)) matched.push(ra);
        }
      }
    }

    if (matched.length === 0) return reminder;

    // Determine warning level
    const uniqueMatched = [...new Set(matched)];
    const level: 'caution' | 'warning' | 'danger' =
      profile.hasSevereHistory ? 'danger' : uniqueMatched.length > 1 ? 'warning' : 'caution';

    const allergenNames = uniqueMatched.join('、');
    const message = level === 'danger'
      ? `含 ${allergenNames} 过敏原，孩子有严重过敏史，务必遵医嘱`
      : `可能含 ${allergenNames} 成分，建议接种前告知医生过敏情况`;

    return {
      ...reminder,
      allergyWarning: { level, message, matchedAllergens: uniqueMatched },
    };
  });
}

/* ================================================================
   4. EVENT-DRIVEN DYNAMIC TASKS
   ================================================================ */

/**
 * Generate follow-up tasks when a significant allergy event is saved.
 *
 * Call this after saving an allergy record. Returns tasks to insert
 * into the reminder system.
 */
export function generateAllergyFollowups(
  childId: string,
  event: {
    allergen: string;
    severity: string;
    symptoms: string[]; // symptom keys like 'rash', 'wheeze'
    eventDate: string;  // ISO date
  },
): DynamicTask[] {
  const tasks: DynamicTask[] = [];
  const nextDay = new Date(event.eventDate);
  nextDay.setDate(nextDay.getDate() + 1);
  const nextDayStr = nextDay.toISOString().split('T')[0] ?? nextDay.toISOString();

  // High-priority symptoms that need next-day followup
  const skinSymptoms = ['rash', 'hives', 'eczema', 'swelling', 'itching'];
  const respiratorySymptoms = ['wheeze', 'cough'];
  const giSymptoms = ['vomiting', 'diarrhea', 'abdominal'];

  const hasSkin = event.symptoms.some((s) => skinSymptoms.includes(s));
  const hasResp = event.symptoms.some((s) => respiratorySymptoms.includes(s));
  const hasGI = event.symptoms.some((s) => giSymptoms.includes(s));
  const isAnaphylaxis = event.symptoms.includes('anaphylaxis');

  // 1. Anaphylaxis → immediate high-priority followup
  if (isAnaphylaxis) {
    tasks.push({
      id: `allergy-followup-anaph-${Date.now()}`,
      childId,
      title: '严重过敏反应后复查',
      description: `昨日发生 ${event.allergen} 严重过敏反应，请立即就医复查，确认是否需要调整紧急用药方案`,
      triggerDate: nextDayStr,
      domain: 'allergy',
      priority: 'P0',
      source: 'allergy-followup',
    });
  }

  // 2. Skin symptoms → observe next day
  if (hasSkin && !isAnaphylaxis) {
    tasks.push({
      id: `allergy-followup-skin-${Date.now()}`,
      childId,
      title: `观察 ${event.allergen} 过敏皮疹消退情况`,
      description: '拍照记录今日皮疹范围，与昨日照片对比。若扩大或加重请及时就医',
      triggerDate: nextDayStr,
      domain: 'allergy',
      priority: 'P1',
      source: 'allergy-followup',
    });
  }

  // 3. Respiratory → monitor
  if (hasResp && !isAnaphylaxis) {
    tasks.push({
      id: `allergy-followup-resp-${Date.now()}`,
      childId,
      title: `关注 ${event.allergen} 过敏呼吸症状`,
      description: '观察咳嗽/喘息是否缓解。若呼吸困难加重请立即就医',
      triggerDate: nextDayStr,
      domain: 'allergy',
      priority: 'P1',
      source: 'allergy-followup',
    });
  }

  // 4. GI symptoms → diet monitoring
  if (hasGI) {
    tasks.push({
      id: `allergy-followup-gi-${Date.now()}`,
      childId,
      title: `${event.allergen} 过敏后饮食观察`,
      description: '今日继续回避可疑食物，观察消化症状是否恢复',
      triggerDate: nextDayStr,
      domain: 'allergy',
      priority: 'P2',
      source: 'allergy-followup',
    });
  }

  // 5. Severe (non-anaphylaxis) → 3-day check
  if (event.severity === 'severe' && !isAnaphylaxis) {
    const threeDaysLater = new Date(event.eventDate);
    threeDaysLater.setDate(threeDaysLater.getDate() + 3);
    tasks.push({
      id: `allergy-followup-3day-${Date.now()}`,
      childId,
      title: `${event.allergen} 重度过敏 3 日复查`,
      description: '距离上次过敏发作已 3 天，请评估症状恢复情况。若仍有症状建议就医',
      triggerDate: threeDaysLater.toISOString().split('T')[0] ?? threeDaysLater.toISOString(),
      domain: 'allergy',
      priority: 'P1',
      source: 'allergy-followup',
    });
  }

  return tasks;
}

/**
 * Generate follow-up reminder for dental events.
 */
export function generateDentalFollowup(
  childId: string,
  eventType: string,
  eventDate: string,
): DynamicTask | null {
  const intervals: Record<string, { months: number; title: string }> = {
    fluoride: { months: 6, title: '涂氟复查' },
    cleaning: { months: 6, title: '定期洁牙' },
    sealant: { months: 12, title: '窝沟封闭复查' },
    checkup: { months: 6, title: '口腔常规检查' },
    filling: { months: 6, title: '补牙后复查' },
  };

  const config = intervals[eventType];
  if (!config) return null;

  const nextDate = new Date(eventDate);
  nextDate.setMonth(nextDate.getMonth() + config.months);

  return {
    id: `dental-followup-${eventType}-${Date.now()}`,
    childId,
    title: config.title,
    description: `距离上次${config.title.replace('复查', '').replace('定期', '')}已${config.months}个月，建议预约口腔检查`,
    triggerDate: nextDate.toISOString().split('T')[0] ?? nextDate.toISOString(),
    domain: 'dental',
    priority: 'P2',
    source: 'dental-followup',
  };
}

/* ================================================================
   5. SEASONAL / CONDITIONAL ALERTS
   ================================================================ */

const SEASONAL_ALERTS: SeasonalAlert[] = [
  {
    id: 'seasonal-pollen-spring',
    title: '春季花粉季防护提醒',
    description: '进入春季花粉高发期，建议：排查家中抗过敏药是否充足、减少花粉浓度高时段外出、外出后清洗面部和鼻腔',
    activeMonths: [3, 4, 5],
    requiredConditions: ['pollen-allergy'],
    priority: 'P1',
  },
  {
    id: 'seasonal-pollen-autumn',
    title: '秋季花粉季防护提醒',
    description: '秋季蒿草/豚草花粉季到来，建议提前备好抗组胺药物，关注花粉浓度预报',
    activeMonths: [8, 9, 10],
    requiredConditions: ['pollen-allergy'],
    priority: 'P1',
  },
  {
    id: 'seasonal-dustmite-humid',
    title: '潮湿季节螨虫防护',
    description: '梅雨/回南天尘螨繁殖活跃，建议除螨清洗床品、开启除湿、检查抗过敏药储备',
    activeMonths: [4, 5, 6, 7],
    requiredConditions: ['dust-mite'],
    priority: 'P2',
  },
  {
    id: 'seasonal-eczema-winter',
    title: '冬季湿疹护理提醒',
    description: '干燥寒冷季节湿疹易复发，建议加强保湿、减少热水洗浴时间、备好润肤剂和外用药膏',
    activeMonths: [11, 12, 1, 2],
    requiredConditions: ['eczema'],
    priority: 'P2',
  },
  {
    id: 'seasonal-asthma-cold',
    title: '换季哮喘防护',
    description: '气温变化大，哮喘易发作。建议确认吸入药物充足、关注空气质量、随身携带急救药物',
    activeMonths: [3, 4, 10, 11],
    requiredConditions: ['asthma'],
    priority: 'P1',
  },
  {
    id: 'seasonal-rhinitis-spring',
    title: '过敏性鼻炎季节提醒',
    description: '过敏性鼻炎高发季到来，建议提前使用鼻用糖皮质激素喷剂预防，备好抗组胺药',
    activeMonths: [3, 4, 5, 9, 10],
    requiredConditions: ['rhinitis'],
    priority: 'P2',
  },
];

/**
 * Check which seasonal alerts should fire based on current date
 * and the child's chronic conditions.
 */
export function getActiveSeasonalAlerts(
  profile: AllergyProfile,
  currentDate: Date = new Date(),
): DynamicTask[] {
  const month = currentDate.getMonth() + 1; // 1-12
  const conditionSet = new Set(profile.chronicConditions);
  // Also check allergen tags for conditions
  if (profile.allergenTags.includes('dust-mite')) conditionSet.add('dust-mite');

  const tasks: DynamicTask[] = [];

  for (const alert of SEASONAL_ALERTS) {
    if (!alert.activeMonths.includes(month)) continue;
    if (!alert.requiredConditions.every((c) => conditionSet.has(c))) continue;

    tasks.push({
      id: alert.id,
      childId: '', // Caller fills this in
      title: alert.title,
      description: alert.description,
      triggerDate: currentDate.toISOString().split('T')[0] ?? currentDate.toISOString(),
      domain: 'allergy',
      priority: alert.priority,
      source: 'seasonal-alert',
    });
  }

  return tasks;
}

/* ================================================================
   6. FRONT-END JSON CONTRACT
   ================================================================ */

/**
 * Example of the enhanced task JSON sent to the front-end:
 *
 * {
 *   "ruleId": "PO-REM-VAC-015",
 *   "title": "流感疫苗（推荐）",
 *   "priority": "P1",
 *   "status": "active",
 *   "domain": "vaccine",
 *   "allergyWarning": {
 *     "level": "warning",
 *     "message": "可能含 egg 成分，建议接种前告知医生过敏情况",
 *     "matchedAllergens": ["egg"]
 *   }
 * }
 *
 * Dynamic tasks (follow-ups, seasonal):
 *
 * {
 *   "id": "allergy-followup-skin-1712345678",
 *   "title": "观察 鸡蛋 过敏皮疹消退情况",
 *   "description": "拍照记录今日皮疹范围...",
 *   "triggerDate": "2026-04-08",
 *   "domain": "allergy",
 *   "priority": "P1",
 *   "source": "allergy-followup"
 * }
 */

/* ================================================================
   7. MEDICAL EVENT SMART ANALYSIS
   ================================================================ */

/** Diagnosis entry extracted from medical events */
export interface DiagnosisEntry {
  diagnosis: string;
  count: number;
  lastDate: string;
  hospitals: string[];
  severity: string | null;
}

/** Medication entry extracted from medical events */
export interface MedicationEntry {
  name: string;
  dosage: string | null;
  count: number;
  lastDate: string;
  relatedDiagnoses: string[];
}

/** Medical alert generated from event pattern analysis */
export interface MedicalAlert {
  level: 'info' | 'warning' | 'danger';
  title: string;
  message: string;
  relatedEventIds: string[];
}

/** Full medical analysis result */
export interface MedicalAnalysis {
  diagnoses: DiagnosisEntry[];
  medications: MedicationEntry[];
  alerts: MedicalAlert[];
  /** Stats */
  totalEvents: number;
  eventsByType: Record<string, number>;
  frequentHospitals: string[];
}

/**
 * Analyze medical events and produce a structured summary of diagnoses,
 * medications, and pattern-based alerts.
 */
export function analyzeMedicalEvents(
  events: Array<{
    eventId: string;
    eventType: string;
    title: string;
    eventDate: string;
    severity: string | null;
    hospital: string | null;
    medication: string | null;
    dosage: string | null;
    notes: string | null;
  }>,
): MedicalAnalysis {
  const diagMap = new Map<string, DiagnosisEntry>();
  const medMap = new Map<string, MedicationEntry>();
  const eventsByType: Record<string, number> = {};
  const hospitalCounts = new Map<string, number>();
  const alerts: MedicalAlert[] = [];

  for (const ev of events) {
    // Count by type
    eventsByType[ev.eventType] = (eventsByType[ev.eventType] ?? 0) + 1;

    // Track hospitals
    if (ev.hospital) {
      hospitalCounts.set(ev.hospital, (hospitalCounts.get(ev.hospital) ?? 0) + 1);
    }

    // Extract diagnosis from title
    const diagKey = ev.title.trim();
    if (diagKey) {
      const existing = diagMap.get(diagKey);
      if (existing) {
        existing.count++;
        if (ev.eventDate > existing.lastDate) existing.lastDate = ev.eventDate;
        if (ev.hospital && !existing.hospitals.includes(ev.hospital)) {
          existing.hospitals.push(ev.hospital);
        }
        if (ev.severity === 'severe') existing.severity = 'severe';
      } else {
        diagMap.set(diagKey, {
          diagnosis: diagKey,
          count: 1,
          lastDate: ev.eventDate,
          hospitals: ev.hospital ? [ev.hospital] : [],
          severity: ev.severity,
        });
      }
    }

    // Extract medications
    if (ev.medication) {
      for (const medName of ev.medication.split(/[,，、;；]/).map((s) => s.trim()).filter(Boolean)) {
        const existing = medMap.get(medName);
        if (existing) {
          existing.count++;
          if (ev.eventDate > existing.lastDate) existing.lastDate = ev.eventDate;
          if (diagKey && !existing.relatedDiagnoses.includes(diagKey)) {
            existing.relatedDiagnoses.push(diagKey);
          }
        } else {
          medMap.set(medName, {
            name: medName,
            dosage: ev.dosage,
            count: 1,
            lastDate: ev.eventDate,
            relatedDiagnoses: diagKey ? [diagKey] : [],
          });
        }
      }
    }
  }

  // ── Pattern-based alerts ──

  // 1. Frequent visits (>3 in 30 days)
  const now = Date.now();
  const recentEvents = events.filter(
    (e) => now - new Date(e.eventDate).getTime() < 30 * 24 * 60 * 60 * 1000,
  );
  if (recentEvents.length >= 3) {
    alerts.push({
      level: 'warning',
      title: '近期就医频繁',
      message: `近 30 天内有 ${recentEvents.length} 次就医记录，建议关注孩子整体健康状况`,
      relatedEventIds: recentEvents.map((e) => e.eventId),
    });
  }

  // 2. Repeated same diagnosis (>2 times)
  for (const diag of diagMap.values()) {
    if (diag.count >= 3) {
      alerts.push({
        level: 'warning',
        title: `反复出现：${diag.diagnosis}`,
        message: `"${diag.diagnosis}"已记录 ${diag.count} 次，建议就医排查根本原因`,
        relatedEventIds: events
          .filter((e) => e.title.trim() === diag.diagnosis)
          .map((e) => e.eventId),
      });
    }
  }

  // 3. Severe events without follow-up
  const severeEvents = events
    .filter((e) => e.severity === 'severe')
    .sort((a, b) => new Date(b.eventDate).getTime() - new Date(a.eventDate).getTime());
  for (const sev of severeEvents) {
    const sevDate = new Date(sev.eventDate).getTime();
    const hasFollowup = events.some(
      (e) =>
        e.eventId !== sev.eventId &&
        e.title.trim() === sev.title.trim() &&
        new Date(e.eventDate).getTime() > sevDate &&
        new Date(e.eventDate).getTime() - sevDate < 30 * 24 * 60 * 60 * 1000,
    );
    if (!hasFollowup && now - sevDate < 60 * 24 * 60 * 60 * 1000) {
      alerts.push({
        level: 'danger',
        title: `重度事件未复查：${sev.title}`,
        message: `${sev.eventDate.split('T')[0]} 的重度事件尚无后续复查记录，强烈建议尽快复诊`,
        relatedEventIds: [sev.eventId],
      });
    }
  }

  // 4. Long-term medication usage (same med in >3 events)
  for (const med of medMap.values()) {
    if (med.count >= 3) {
      alerts.push({
        level: 'info',
        title: `长期用药：${med.name}`,
        message: `"${med.name}"已使用 ${med.count} 次，建议定期评估用药必要性和副作用`,
        relatedDiagnoses: med.relatedDiagnoses,
        relatedEventIds: events
          .filter((e) => e.medication?.includes(med.name))
          .map((e) => e.eventId),
      } as MedicalAlert);
    }
  }

  // Sort
  const diagnoses = [...diagMap.values()].sort((a, b) => b.count - a.count);
  const medications = [...medMap.values()].sort((a, b) => b.count - a.count);
  const frequentHospitals = [...hospitalCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([h]) => h);

  return {
    diagnoses,
    medications,
    alerts,
    totalEvents: events.length,
    eventsByType,
    frequentHospitals,
  };
}
