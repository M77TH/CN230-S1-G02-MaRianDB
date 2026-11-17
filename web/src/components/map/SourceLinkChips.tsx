import React from 'react';
import { ExternalLink } from 'lucide-react';
import { formatSourceHost, type SourceLink } from '../../utils/sourceLinks';

interface SourceLinkChipsProps {
  links: SourceLink[];
  variant?: 'chips' | 'list' | 'inline';
  showHost?: boolean;
  className?: string;
}

/** Shared clickable webpage link renderer for all Map page source citations. */
export const SourceLinkChips: React.FC<SourceLinkChipsProps> = ({
  links,
  variant = 'chips',
  showHost = false,
  className = ''
}) => {
  if (!links.length) return null;

  if (variant === 'list') {
    return (
      <div className={`source-links-stack ${className}`.trim()}>
        {links.map((link) => (
          <a
            key={link.url}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="clean-doc-link font-mono"
            title={`${link.label} — ${link.url}`}
          >
            <ExternalLink size={11} />
            <span className="source-link-text">
              <strong>{link.id}:</strong> {link.label} ({link.url})
            </span>
          </a>
        ))}
      </div>
    );
  }

  if (variant === 'inline') {
    return (
      <span className={`source-links-inline ${className}`.trim()}>
        {links.map((link) => (
          <a
            key={link.url}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="source-inline-link font-mono"
            title={`${link.label} — ${link.url}`}
          >
            <span>{link.id}</span>
            {showHost && <span className="source-link-host">({formatSourceHost(link.url)})</span>}
            <ExternalLink size={10} />
          </a>
        ))}
      </span>
    );
  }

  return (
    <div className={`source-link-chips ${className}`.trim()}>
      {links.map((link) => (
        <a
          key={link.url}
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          className="source-link-chip font-mono"
          title={`${link.label} — ${link.url}`}
        >
          <ExternalLink size={10} />
          <span>{link.id}</span>
          {showHost && <span className="source-link-host">· {formatSourceHost(link.url)}</span>}
        </a>
      ))}
    </div>
  );
};
