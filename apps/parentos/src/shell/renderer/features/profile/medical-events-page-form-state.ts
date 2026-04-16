import { useCallback, useMemo, useRef, useState } from 'react';

import { computeAgeMonthsAt } from '../../app-shell/app-store.js';
import { insertMedicalEvent, getMedicalEvents, updateMedicalEvent } from '../../bridge/sqlite-bridge.js';
import type { MedicalEventRow } from '../../bridge/sqlite-bridge.js';
import { isoNow, ulid } from '../../bridge/ulid.js';
import { getPlatformClient } from '@nimiplatform/sdk';

import { readImageFileAsDataUrl } from './checkup-ocr.js';
import { EVENT_TYPE_LABELS, LAB_ITEMS, parseLabReport, type LabReportData } from './medical-events-page-shared.js';
import {
  buildParentosRuntimeMetadata,
  ensureParentosLocalRuntimeReady,
  PARENTOS_LOCAL_RUNTIME_WARM_TIMEOUT_MS,
  resolveParentosTextRuntimeConfig,
} from '../settings/parentos-ai-runtime.js';
import type {
  MedicalEventsChildContext,
  MedicalEventsFormMedication,
} from './medical-events-page-types.js';

export function useMedicalEventsFormState(
  child: MedicalEventsChildContext | undefined,
  events: MedicalEventRow[],
  setEvents: (events: MedicalEventRow[]) => void,
) {
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);

  const [formEventType, setFormEventType] = useState('visit');
  const [formTitle, setFormTitle] = useState('');
  const [formEventDate, setFormEventDate] = useState(new Date().toISOString().slice(0, 10));
  const [formEndDate, setFormEndDate] = useState('');
  const [formSeverity, setFormSeverity] = useState('');
  const [formResult, setFormResult] = useState('');
  const [formHospital, setFormHospital] = useState('');
  const [formMedication, setFormMedication] = useState('');
  const [formDosage, setFormDosage] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formLabValues, setFormLabValues] = useState<Record<string, string>>({});
  const [formSymptomTags, setFormSymptomTags] = useState<Set<string>>(new Set());
  const [formMeds, setFormMeds] = useState<MedicalEventsFormMedication[]>([]);
  const [formShowEndDate, setFormShowEndDate] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [ocrImageName, setOcrImageName] = useState<string | null>(null);
  const ocrInputRef = useRef<HTMLInputElement>(null);

  const resetForm = useCallback(() => {
    setFormEventType('visit');
    setFormTitle('');
    setFormEventDate(new Date().toISOString().slice(0, 10));
    setFormEndDate('');
    setFormSeverity('');
    setFormResult('');
    setFormHospital('');
    setFormMedication('');
    setFormDosage('');
    setFormNotes('');
    setFormLabValues({});
    setFormSymptomTags(new Set());
    setFormMeds([]);
    setFormShowEndDate(false);
    setSubmitError(null);
    setShowForm(false);
  }, []);

  const closeForm = useCallback(() => {
    setEditingEventId(null);
    resetForm();
  }, [resetForm]);

  const handleOCRUpload = useCallback(async (file: File) => {
    setOcrLoading(true);
    setOcrError(null);
    setOcrImageName(file.name);
    try {
      const imageUrl = await readImageFileAsDataUrl(file);
      const client = getPlatformClient();
      if (!client.runtime?.ai?.text?.generate) {
        setOcrError('AI 运行时不可用，请确认已启动');
        return;
      }

      const prompt = [
        '你是一位医疗记录识别助手。请从这张病历/处方单图片中提取以下信息，以 JSON 格式输出：',
        '{',
        '  "eventType": "visit|emergency|hospitalization|checkup|medication|other",',
        '  "title": "诊断/主要症状",',
        '  "eventDate": "YYYY-MM-DD 或 null",',
        '  "hospital": "医院名称 或 null",',
        '  "severity": "mild|moderate|severe 或 null",',
        '  "medications": [{"name":"药名","dose":"剂量","unit":"单位","frequency":"用法","days":"天数"}],',
        '  "notes": "其他重要信息摘要 或 null"',
        '}',
        '规则：',
        '- 仅提取图片中明确可见的信息，不要推测。',
        '- 如果某字段在图片中找不到，设为 null。',
        '- medications 数组只包含图片中明确列出的药品。',
        '- 仅输出 JSON，不要输出其他内容。',
      ].join('\n');

      const ocrParams = await resolveParentosTextRuntimeConfig('parentos.medical.ocr-intake', { temperature: 0, maxTokens: 1000 });
      await ensureParentosLocalRuntimeReady({
        route: ocrParams.route,
        localModelId: ocrParams.localModelId,
        timeoutMs: PARENTOS_LOCAL_RUNTIME_WARM_TIMEOUT_MS,
      });
      const output = await client.runtime.ai.text.generate({
        ...ocrParams,
        input: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', imageUrl, detail: 'high' },
          ],
        }],
        metadata: buildParentosRuntimeMetadata('parentos.medical.ocr-intake'),
      });

      const jsonMatch = output.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        setOcrError('未能从图片中识别出有效信息');
        return;
      }

      const data = JSON.parse(jsonMatch[0]) as {
        eventType?: string;
        title?: string;
        eventDate?: string | null;
        hospital?: string | null;
        severity?: string | null;
        medications?: Array<{ name?: string; dose?: string; unit?: string; frequency?: string; days?: string }>;
        notes?: string | null;
      };

      if (data.eventType && data.eventType in EVENT_TYPE_LABELS) setFormEventType(data.eventType);
      if (data.title) setFormTitle(data.title);
      if (data.eventDate) setFormEventDate(data.eventDate);
      if (data.hospital) setFormHospital(data.hospital);
      if (data.severity && ['mild', 'moderate', 'severe'].includes(data.severity)) setFormSeverity(data.severity);
      if (data.notes) setFormNotes(data.notes);

      if (data.medications && data.medications.length > 0) {
        setFormMeds(data.medications.map((medication) => ({
          name: medication.name ?? '',
          dose: medication.dose ?? '',
          unit: medication.unit ?? '次',
          frequency: medication.frequency ?? '',
          days: medication.days ?? '',
          tags: [],
        })));
      }
    } catch (error) {
      setOcrError(error instanceof Error ? error.message : '识别失败，请重试');
    } finally {
      setOcrLoading(false);
    }
  }, []);

  const submitForm = useCallback(async () => {
    if (!child) return;

    const isLab = formEventType === 'lab-report';
    const effectiveTitle = isLab ? '检验报告' : formTitle.trim();
    if (!isLab && !formTitle.trim()) {
      setSubmitError('请填写诊断或症状');
      return;
    }
    if (!formEventDate) {
      setSubmitError('请选择发生日期');
      return;
    }

    setSubmitError(null);
    setSaving(true);

    let effectiveNotes = formNotes || null;
    if (isLab) {
      const labValues: Record<string, number | null> = {};
      for (const item of LAB_ITEMS) {
        const value = formLabValues[item.key];
        labValues[item.key] = value ? parseFloat(value) : null;
      }
      effectiveNotes = JSON.stringify({ type: 'lab-report', values: labValues } satisfies LabReportData);
    }

    const symptomStr = formSymptomTags.size > 0 ? [...formSymptomTags].join('、') : '';
    const fullTitle = [effectiveTitle, symptomStr].filter(Boolean).join(' — ');
    const medicationSummary = formMeds.length > 0
      ? formMeds
        .filter((medication) => medication.name.trim())
        .map((medication) => {
          const parts = [medication.name.trim()];
          if (medication.dose) parts.push(`${medication.dose}${medication.unit}`);
          if (medication.frequency) parts.push(medication.frequency);
          if (medication.days) parts.push(`${medication.days}天`);
          return parts.join(' ');
        })
        .join('；')
      : formMedication || null;

    try {
      if (editingEventId) {
        await updateMedicalEvent({
          eventId: editingEventId,
          title: isLab ? '检验报告' : formTitle.trim(),
          eventDate: formEventDate,
          endDate: formEndDate || null,
          severity: formSeverity || null,
          result: formResult || null,
          hospital: formHospital || null,
          medication: isLab ? null : (formMedication || null),
          dosage: isLab ? null : (formDosage || null),
          notes: effectiveNotes,
          photoPath: null,
          now: isoNow(),
        });
      } else {
        const now = isoNow();
        await insertMedicalEvent({
          eventId: ulid(),
          childId: child.childId,
          eventType: formEventType,
          title: fullTitle || effectiveTitle,
          eventDate: formEventDate,
          endDate: formShowEndDate && formEndDate ? formEndDate : null,
          ageMonths: computeAgeMonthsAt(child.birthDate, formEventDate),
          severity: formSeverity || null,
          result: formResult || null,
          hospital: formHospital || null,
          medication: isLab ? null : (medicationSummary || null),
          dosage: isLab ? null : (formDosage || null),
          notes: effectiveNotes,
          photoPath: null,
          now,
        });
      }

      const updatedEvents = await getMedicalEvents(child.childId);
      setEvents(updatedEvents);
      setEditingEventId(null);
      resetForm();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSubmitError(`保存失败：${message}`);
    } finally {
      setSaving(false);
    }
  }, [
    child,
    editingEventId,
    formDosage,
    formEndDate,
    formEventDate,
    formEventType,
    formHospital,
    formLabValues,
    formMeds,
    formMedication,
    formNotes,
    formResult,
    formSeverity,
    formShowEndDate,
    formSymptomTags,
    formTitle,
    resetForm,
    setEvents,
  ]);

  const startEditing = useCallback((event: MedicalEventRow) => {
    setEditingEventId(event.eventId);
    setFormEventType(event.eventType);
    setFormTitle(event.title);
    setFormEventDate(event.eventDate.split('T')[0] ?? '');
    setFormEndDate(event.endDate?.split('T')[0] ?? '');
    setFormSeverity(event.severity ?? '');
    setFormResult(event.result ?? '');
    setFormHospital(event.hospital ?? '');
    setFormMedication(event.medication ?? '');
    setFormDosage(event.dosage ?? '');
    setFormNotes(event.notes ?? '');

    const labData = parseLabReport(event.notes);
    if (labData) {
      const nextLabValues: Record<string, string> = {};
      for (const [key, value] of Object.entries(labData.values)) {
        if (value != null) nextLabValues[key] = String(value);
      }
      setFormLabValues(nextLabValues);
    } else {
      setFormLabValues({});
    }

    setSubmitError(null);
    setShowForm(true);
  }, []);

  const historyDrugs = useMemo(() => {
    const drugMap = new Map<string, { name: string; unit?: string; frequency?: string }>();
    for (const event of events) {
      if (!event.medication) continue;
      for (const chunk of event.medication.split('；')) {
        const name = chunk.split(/\s/)[0]?.trim();
        if (name && !drugMap.has(name)) drugMap.set(name, { name });
      }
    }
    return [...drugMap.values()];
  }, [events]);

  return {
    showForm,
    setShowForm,
    saving,
    submitError,
    editingEventId,
    formEventType,
    setFormEventType,
    formTitle,
    setFormTitle,
    formEventDate,
    setFormEventDate,
    formEndDate,
    setFormEndDate,
    formSeverity,
    setFormSeverity,
    formResult,
    setFormResult,
    formHospital,
    setFormHospital,
    formMedication,
    setFormMedication,
    formDosage,
    setFormDosage,
    formNotes,
    setFormNotes,
    formLabValues,
    setFormLabValues,
    formSymptomTags,
    setFormSymptomTags,
    formMeds,
    setFormMeds,
    formShowEndDate,
    setFormShowEndDate,
    ocrLoading,
    ocrError,
    ocrImageName,
    ocrInputRef,
    historyDrugs,
    closeForm,
    handleOCRUpload,
    submitForm,
    startEditing,
  };
}
