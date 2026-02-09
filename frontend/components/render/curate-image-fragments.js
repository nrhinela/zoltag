import { html } from 'lit';

export function renderCurateAiMLScore(host, image) {
  const isAiMode = host.curateAuditMode === 'missing'
    && host.curateAuditAiEnabled
    && !!host.curateAuditAiModel
    && host.curateAuditKeyword;

  if (!isAiMode) return html``;

  const tags = Array.isArray(image?.tags) ? image.tags : [];
  const mlTag = tags.find((tag) => tag.keyword === host.curateAuditKeyword);
  if (!mlTag) return html``;

  return html``;
}

export function renderCuratePermatagSummary(image) {
  const permatags = Array.isArray(image?.permatags) ? image.permatags : [];
  const positives = permatags.filter((tag) => tag.signum === 1 && tag.keyword);
  if (!positives.length) return html``;
  const keywords = positives
    .map((tag) => tag.keyword)
    .filter(Boolean);
  if (!keywords.length) return html``;
  const unique = Array.from(new Set(keywords));
  return html`
    <div class="curate-thumb-rating">Tags: ${unique.join(', ')}</div>
  `;
}
