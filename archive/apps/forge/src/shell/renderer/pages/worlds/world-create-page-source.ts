import { useCallback, useRef, useState } from 'react';

type UseWorldCreatePageSourceInput = {
  patchSnapshot: (patch: { sourceRef?: string }) => void;
};

type SourceEncoding = 'utf-8' | 'gb18030' | 'utf-16le';
type SourceMode = 'TEXT' | 'FILE';

export function useWorldCreatePageSource(input: UseWorldCreatePageSourceInput) {
  const [sourceMode, setSourceMode] = useState<SourceMode>('TEXT');
  const [sourceEncoding, setSourceEncoding] = useState<SourceEncoding>('utf-8');
  const [filePreviewText, setFilePreviewText] = useState('');
  const sourceRawTextRef = useRef('');

  const onSourceEncodingChange = useCallback((encoding: SourceEncoding) => {
    setSourceEncoding(encoding);
  }, []);

  const onSelectSourceFile = useCallback((file: File | null) => {
    if (!file) {
      setSourceMode('TEXT');
      setFilePreviewText('');
      return;
    }
    setSourceMode('FILE');
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      setFilePreviewText(text.slice(0, 2000));
      sourceRawTextRef.current = text;
      input.patchSnapshot({ sourceRef: file.name });
    };
    reader.readAsText(file, sourceEncoding);
  }, [input.patchSnapshot, sourceEncoding]);

  return {
    filePreviewText,
    onSelectSourceFile,
    onSourceEncodingChange,
    sourceEncoding,
    sourceMode,
    sourceRawTextRef,
  };
}
