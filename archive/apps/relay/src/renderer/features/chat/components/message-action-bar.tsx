// Message action bar — copy, regenerate, feedback
// Per design.md §5: hover-reveal actions below AI messages

import { useState, useCallback } from 'react';
import { Copy, Check, RefreshCw, ThumbsUp, ThumbsDown } from 'lucide-react';

interface MessageActionBarProps {
  content: string;
  onRegenerate?: () => void;
}

export function MessageActionBar({ content, onRegenerate }: MessageActionBarProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [content]);

  return (
    <div className="flex items-center gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
      <ActionButton onClick={handleCopy} title="Copy">
        {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
      </ActionButton>
      {onRegenerate && (
        <ActionButton onClick={onRegenerate} title="Regenerate">
          <RefreshCw size={14} />
        </ActionButton>
      )}
      <ActionButton onClick={() => {}} title="Like">
        <ThumbsUp size={14} />
      </ActionButton>
      <ActionButton onClick={() => {}} title="Dislike">
        <ThumbsDown size={14} />
      </ActionButton>
    </div>
  );
}

function ActionButton({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="p-1.5 rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors duration-150"
    >
      {children}
    </button>
  );
}
