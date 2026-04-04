import { describe, expect, it } from 'vitest';
import { BANNED_TERMS, containsBannedTerm, filterAIResponse } from './ai-safety-filter.js';

describe('ai-safety-filter', () => {
  describe('BANNED_TERMS', () => {
    it('contains the ParentOS banned wording set', () => {
      expect(BANNED_TERMS).toContain('发育迟缓');
      expect(BANNED_TERMS).toContain('异常');
      expect(BANNED_TERMS).toContain('障碍');
      expect(BANNED_TERMS).toContain('应该');
      expect(BANNED_TERMS).toContain('应该吃');
      expect(BANNED_TERMS).toContain('建议用药');
      expect(BANNED_TERMS).toContain('建议服用');
      expect(BANNED_TERMS).toContain('建议治疗');
      expect(BANNED_TERMS).toContain('推荐治疗');
      expect(BANNED_TERMS).toContain('落后');
      expect(BANNED_TERMS).toContain('危险');
      expect(BANNED_TERMS).toContain('警告');
    });
  });

  describe('containsBannedTerm', () => {
    it('returns false for safe text', () => {
      expect(containsBannedTerm('观察到孩子可能对音乐感兴趣。')).toBe(false);
      expect(containsBannedTerm('建议咨询专业人士。')).toBe(false);
      expect(containsBannedTerm('这是一个客观异常值记录。')).toBe(false);
    });

    it('returns true for diagnostic language', () => {
      expect(containsBannedTerm('孩子可能存在发育迟缓的情况。')).toBe(true);
      expect(containsBannedTerm('这种行为属于异常表现。')).toBe(true);
      expect(containsBannedTerm('可能是语言障碍。')).toBe(true);
      expect(containsBannedTerm('孩子表現出異常反應。')).toBe(true);
    });

    it('returns true for medical advice language', () => {
      expect(containsBannedTerm('家长应该尽快处理。')).toBe(true);
      expect(containsBannedTerm('孩子应该吃更多补剂。')).toBe(true);
      expect(containsBannedTerm('建议用药治疗。')).toBe(true);
      expect(containsBannedTerm('建议服用维生素。')).toBe(true);
      expect(containsBannedTerm('建议治疗。')).toBe(true);
      expect(containsBannedTerm('推薦治療方案。')).toBe(true);
    });

    it('returns true for anxiety language', () => {
      expect(containsBannedTerm('孩子的发展已经落后了。')).toBe(true);
      expect(containsBannedTerm('这是一个危险的信号。')).toBe(true);
      expect(containsBannedTerm('警告：需要立刻就医。')).toBe(true);
    });
  });

  describe('filterAIResponse', () => {
    it('passes safe text through unchanged', () => {
      const text = '观察到孩子在专注力方面有进步的倾向。建议咨询专业人士获取更详细的评估。';
      const result = filterAIResponse(text);
      expect(result.safe).toBe(true);
      expect(result.filtered).toBe(text);
      expect(result.triggeredTerm).toBeNull();
    });

    it('blocks text with banned terms', () => {
      const text = '孩子的身高发育已经落后于同龄人标准。';
      const result = filterAIResponse(text);
      expect(result.safe).toBe(false);
      expect(result.filtered).not.toBe(text);
      expect(result.filtered).toContain('建议咨询专业人士');
      expect(result.triggeredTerm).toBe('落后');
    });

    it('reports the first triggered term', () => {
      const result = filterAIResponse('发育迟缓且存在异常。');
      expect(result.safe).toBe(false);
      expect(result.triggeredTerm).toBe('发育迟缓');
    });

    it('filters traditional Chinese variants too', () => {
      const result = filterAIResponse('這是危險訊號，建議治療。');
      expect(result.safe).toBe(false);
      expect(result.triggeredTerm).toBe('建议治疗');
    });
  });
});
