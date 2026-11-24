import React, { memo, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';

function extractText(node: React.ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
    return extractText(node.props.children);
  }
  return '';
}

function extractLanguage(node: React.ReactNode): string {
  if (React.isValidElement<{ className?: string; children?: React.ReactNode }>(node)) {
    const className = node.props.className || '';
    const match = /language-([\w+-]+)/i.exec(className);
    if (match?.[1]) return match[1].toLowerCase();
  }
  return 'code';
}

const MARKDOWN_REMARK_PLUGINS = [remarkGfm];
const MARKDOWN_REHYPE_PLUGINS = [rehypeHighlight];

const CodeBlock = memo(function CodeBlock({ children }: { children?: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const rawText = extractText(children).replace(/\n$/, '');
  const language = extractLanguage(children);

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(rawText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard write unavailable
    }
  };

  return (
    <div className="my-2 rounded-[12px] overflow-hidden border border-white/10 bg-[#060A14]">
      <div className="flex items-center justify-between px-3 py-1 bg-white/[0.04] border-b border-white/[0.06] text-[11px] font-sans text-[#9AA7BF]">
        <span className="font-mono lowercase tracking-wide">{language}</span>
        <button
          type="button"
          onClick={() => void handleCopyCode()}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[#B4BFD4] hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
          aria-label="Copy code block"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-emerald-400" />
              <span className="text-emerald-300">Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre>{children}</pre>
    </div>
  );
});

const MARKDOWN_COMPONENTS = {
  pre: ({ children }: { children?: React.ReactNode }) => <CodeBlock>{children}</CodeBlock>,
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="overflow-x-auto my-2">
      <table>{children}</table>
    </div>
  ),
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
};

export const MarkdownContent = memo(function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="council-prose break-words">
      <ReactMarkdown
        remarkPlugins={MARKDOWN_REMARK_PLUGINS}
        rehypePlugins={MARKDOWN_REHYPE_PLUGINS}
        components={MARKDOWN_COMPONENTS}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
