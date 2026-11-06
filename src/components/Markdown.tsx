import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { markdownUrlTransform, safeExternalUrl } from '../lib/urls';

/**
 * Renders user- or admin-supplied Markdown so that it can never load or run
 * scripts:
 *  - raw HTML is never turned into elements: `remarkHtmlAsText` turns every
 *    raw-HTML node into plain text, which React escapes (never add rehype-raw),
 *  - `urlTransform` keeps only HTTP(S) URLs, neutralising `javascript:`/`data:`,
 *  - Markdown images pointing to external HTTP(S) hosts are rendered as plain
 *    `<img>` with no referrer, lazily, and a broken image only hides itself.
 */

interface MdNode { type: string; value?: string; children?: MdNode[] }

const PHRASING_PARENTS = new Set(['paragraph', 'heading', 'emphasis', 'strong', 'delete', 'link', 'linkReference', 'tableCell']);

export function remarkHtmlAsText() {
  const visit = (node: MdNode) => {
    if (!node.children) return;
    const phrasing = PHRASING_PARENTS.has(node.type);
    node.children = node.children.map((child) => {
      if (child.type !== 'html') {
        visit(child);
        return child;
      }
      const text: MdNode = { type: 'text', value: child.value ?? '' };
      return phrasing ? text : { type: 'paragraph', children: [text] };
    });
  };
  return (tree: MdNode) => visit(tree);
}

function ExternalImage({ src, alt, fallbackAlt }: { src?: string; alt?: string; fallbackAlt: string }) {
  const [failed, setFailed] = useState(false);
  const safe = typeof src === 'string' ? safeExternalUrl(src) : null;
  if (!safe || failed) {
    return alt ? <span className="markdown-image-fallback">[{alt}]</span> : null;
  }
  return (
    <img
      className="markdown-image"
      src={safe}
      alt={alt || fallbackAlt}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

export function Markdown({ children, imageAlt = 'Image' }: { children: string; imageAlt?: string }) {
  const components: Components = {
    a: ({ href, children: linkChildren }) => {
      const safe = href ? safeExternalUrl(href) : null;
      return safe ? (
        <a href={safe} target="_blank" rel="noopener noreferrer nofollow">
          {linkChildren}
        </a>
      ) : (
        <span>{linkChildren}</span>
      );
    },
    img: ({ src, alt }) => <ExternalImage src={typeof src === 'string' ? src : undefined} alt={alt} fallbackAlt={imageAlt} />,
  };
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkHtmlAsText]}
        urlTransform={markdownUrlTransform}
        components={components}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
