import { html } from 'lit';

export function renderCurateAiMLScore(host, image) {
  const isCurateAuditMissingView = host.curateSubTab === 'tag-audit'
    && host.curateAuditMode === 'missing';
  const isAiMode = host.curateAuditMode === 'missing'
    && !!(String(host.curateAuditAiModel || '').trim() || 'siglip')
    && host.curateAuditKeyword;

  if (!isAiMode || !isCurateAuditMissingView) return html``;
  const aiModel = String(host.curateAuditAiModel || '').trim().toLowerCase();

  if (aiModel === 'ml-similarity') {
    const similarityScore = Number(image?.similarity_score);
    if (!Number.isFinite(similarityScore)) return html``;
    const label = image?.similarity_seed ? 'Similarity (seed)' : 'Similarity';
    return html`
      <div class="curate-thumb-ml-score">
        ${label}: ${similarityScore.toFixed(2)}
      </div>
    `;
  }

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
  const keywords = positives.map((tag) => tag.keyword).filter(Boolean);
  const unique = Array.from(new Set(keywords));
  const variantCount = Number(image?.variant_count || 0);
  const hasVariants = Number.isFinite(variantCount) && variantCount > 0;
  if (!unique.length && !hasVariants) return html``;
  const label = unique.length ? unique.join(', ') : 'none';
  const variantTitle = hasVariants
    ? `${variantCount} variant${variantCount === 1 ? '' : 's'}`
    : '';
  return html`
    <div class="curate-thumb-rating ${hasVariants ? 'has-variant' : ''}">
      ${hasVariants ? html`
        <span class="curate-thumb-variant-count" title=${variantTitle}>V${variantCount}</span>
      ` : html``}
      <span class="curate-thumb-rating-label">Tags: ${label}</span>
    </div>
  `;
}
