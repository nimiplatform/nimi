import { useRef, useState } from 'react';
import { S } from '../../app-shell/page-style.js';
import { isoNow, ulid } from '../../bridge/ulid.js';
import type { NarrativeReportContent, UserNote } from './structured-report.js';

const SERIF = "var(--font-serif, 'Noto Serif SC', 'Source Han Serif SC', 'Songti SC', 'STSong', Georgia, serif)";
const FG1 = S.text;
const FG3 = S.sub;
const FG4 = '#94a3b8';
const ACCENT = S.accent;

const NOTE_BG = 'rgba(254,249,195,0.65)';
const NOTE_BORDER = 'rgba(234,179,8,0.35)';
const NOTE_INK = '#78350f';

export function getNotesForAnchor(content: NarrativeReportContent, anchor: string): UserNote[] {
  if (!content.userNotes) return [];
  return content.userNotes.filter((n) => n.anchor === anchor);
}

export function addUserNote(content: NarrativeReportContent, anchor: string, text: string): NarrativeReportContent {
  const now = isoNow();
  const next: UserNote = { id: ulid(), anchor, text, createdAt: now, updatedAt: now };
  return { ...content, userNotes: [...(content.userNotes ?? []), next] };
}

export function updateUserNote(content: NarrativeReportContent, id: string, text: string): NarrativeReportContent {
  const now = isoNow();
  return {
    ...content,
    userNotes: (content.userNotes ?? []).map((n) => n.id === id ? { ...n, text, updatedAt: now } : n),
  };
}

export function deleteUserNote(content: NarrativeReportContent, id: string): NarrativeReportContent {
  return {
    ...content,
    userNotes: (content.userNotes ?? []).filter((n) => n.id !== id),
  };
}

/* ── UI ─────────────────────────────────────────────────────── */

interface NoteCardProps {
  note: UserNote;
  canEdit: boolean;
  onSave: (text: string) => void;
  onDelete: () => void;
}

function NoteCard({ note, canEdit, onSave, onDelete }: NoteCardProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.text);
  const ref = useRef<HTMLTextAreaElement>(null);
  const start = () => { setDraft(note.text); setEditing(true); setTimeout(() => ref.current?.focus(), 0); };
  const date = note.updatedAt ? note.updatedAt.slice(0, 10) : '';

  if (editing) {
    return (
      <div style={{
        marginTop: 10, padding: '12px 14px',
        background: NOTE_BG, border: `1px solid ${NOTE_BORDER}`, borderRadius: 12,
      }}>
        <textarea ref={ref} value={draft} onChange={(e) => setDraft(e.target.value)}
          style={{
            width: '100%', minHeight: 72, padding: '8px 10px',
            borderRadius: 8, border: `1px solid ${NOTE_BORDER}`,
            background: 'rgba(255,255,255,0.9)', color: FG1,
            fontFamily: 'inherit', fontSize: 13.5, lineHeight: 1.7,
            outline: 'none', resize: 'vertical',
          }} />
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button onClick={() => { const t = draft.trim(); if (!t) return; onSave(t); setEditing(false); }}
            style={{ padding: '5px 12px', borderRadius: 8, border: 0, background: ACCENT, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            保存
          </button>
          <button onClick={() => setEditing(false)}
            style={{ padding: '5px 12px', borderRadius: 8, border: 0, background: 'transparent', color: FG3, fontSize: 12, cursor: 'pointer' }}>
            取消
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      marginTop: 10, padding: '12px 14px',
      background: NOTE_BG, border: `1px solid ${NOTE_BORDER}`, borderRadius: 12,
      position: 'relative',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={NOTE_INK} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 20h9M16.5 3.5a2.1 2.1 0 113 3L7 19l-4 1 1-4L16.5 3.5z" />
        </svg>
        <span style={{ fontSize: 10, letterSpacing: '0.14em', fontWeight: 600, textTransform: 'uppercase', color: NOTE_INK }}>
          家长备注
        </span>
        {date ? (
          <span style={{ fontSize: 10, color: FG4, marginLeft: 'auto', fontFamily: 'var(--nimi-font-mono, ui-monospace, monospace)' }}>{date}</span>
        ) : null}
      </div>
      <p style={{
        margin: 0, fontFamily: SERIF, fontSize: 13.5, lineHeight: 1.75, color: FG1,
        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      }}>
        {note.text}
      </p>
      {canEdit ? (
        <div className="hide-on-print" style={{
          display: 'flex', gap: 10, marginTop: 10, paddingTop: 8,
          borderTop: `1px dashed ${NOTE_BORDER}`,
          justifyContent: 'flex-end',
        }}>
          <button onClick={start}
            style={{ padding: '3px 10px', borderRadius: 6, border: 0, background: 'transparent', color: NOTE_INK, fontSize: 11, fontWeight: 500, cursor: 'pointer' }}>
            编辑
          </button>
          <button onClick={onDelete}
            style={{ padding: '3px 10px', borderRadius: 6, border: 0, background: 'transparent', color: '#9f1239', fontSize: 11, fontWeight: 500, cursor: 'pointer' }}>
            删除
          </button>
        </div>
      ) : null}
    </div>
  );
}

interface NoteComposerProps {
  onAdd: (text: string) => void;
}

function NoteComposer({ onAdd }: NoteComposerProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  const openComposer = () => {
    setDraft(''); setOpen(true);
    setTimeout(() => ref.current?.focus(), 0);
  };
  const submit = () => {
    const t = draft.trim();
    if (!t) { setOpen(false); return; }
    onAdd(t);
    setDraft(''); setOpen(false);
  };

  if (!open) {
    return (
      <button onClick={openComposer}
        className="report-note-composer hide-on-print"
        style={{
          marginTop: 10,
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '5px 12px', borderRadius: 999,
          background: 'rgba(254,249,195,0.4)', color: NOTE_INK,
          border: `1px dashed ${NOTE_BORDER}`,
          fontSize: 11.5, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
        }}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
        追加我的备注
      </button>
    );
  }

  return (
    <div className="report-note-composer hide-on-print" style={{
      marginTop: 10, padding: '12px 14px',
      background: NOTE_BG, border: `1px solid ${NOTE_BORDER}`, borderRadius: 12,
    }}>
      <textarea ref={ref} value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="写一段备注，比如你对这一段观察的补充、疑问、或想让医生看到的细节……"
        style={{
          width: '100%', minHeight: 72, padding: '8px 10px',
          borderRadius: 8, border: `1px solid ${NOTE_BORDER}`,
          background: 'rgba(255,255,255,0.9)', color: FG1,
          fontFamily: 'inherit', fontSize: 13.5, lineHeight: 1.7,
          outline: 'none', resize: 'vertical',
        }} />
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button onClick={submit}
          style={{ padding: '5px 12px', borderRadius: 8, border: 0, background: ACCENT, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
          保存备注
        </button>
        <button onClick={() => setOpen(false)}
          style={{ padding: '5px 12px', borderRadius: 8, border: 0, background: 'transparent', color: FG3, fontSize: 12, cursor: 'pointer' }}>
          取消
        </button>
      </div>
    </div>
  );
}

interface NoteAnchorProps {
  anchor: string;
  content: NarrativeReportContent;
  canEdit: boolean;
  onChange: (next: NarrativeReportContent) => void;
}

export function NoteAnchor({ anchor, content, canEdit, onChange }: NoteAnchorProps) {
  const notes = getNotesForAnchor(content, anchor);
  const handleAdd = (text: string) => onChange(addUserNote(content, anchor, text));
  const handleUpdate = (id: string, text: string) => onChange(updateUserNote(content, id, text));
  const handleDelete = (id: string) => onChange(deleteUserNote(content, id));

  return (
    <div style={{ marginTop: 4 }}>
      {notes.map((n) => (
        <NoteCard key={n.id} note={n} canEdit={canEdit}
          onSave={(t) => handleUpdate(n.id, t)}
          onDelete={() => handleDelete(n.id)} />
      ))}
      {canEdit ? <NoteComposer onAdd={handleAdd} /> : null}
    </div>
  );
}

/** Flattens all notes in the report, newest first, used by the professional export. */
export function listNotesSorted(content: NarrativeReportContent): UserNote[] {
  return [...(content.userNotes ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
