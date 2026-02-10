import { html } from 'lit';

export function renderCurateAiMLScore(host, image) {
  const isCurateAuditMissingView = host.curateSubTab === 'tag-audit'
    && host.curateAuditMode === 'missing';
  const isAiMode = host.curateAuditMode === 'missing'
    && host.curateAuditAiEnabled
    && !!host.curateAuditAiModel
    && host.curateAuditKeyword;

  if (!isAiMode || !isCurateAuditMissingView) return html``;

  const tags = Array.isArray(image?.tags) ? image.tags : [];
  const keyword = String(host.curateAuditKeyword || '').trim().toLowerCase();
  const matches = tags.filter((tag) => String(tag?.keyword || '').trim().toLowerCase() === keyword);
  if (!matches.length) return html``;

  const confidence = matches.reduce((maxScore, tag) => {
    const value = Number(tag?.confidence);
    return Number.isFinite(value) ? Math.max(maxScore, value) : maxScore;
  }, Number.NEGATIVE_INFINITY);
  if (!Number.isFinite(confidence)) return html``;

  return html`
    <div class="curate-thumb-ml-score">
      Confidence: ${confidence.toFixed(2)}
    </div>
  `;
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
