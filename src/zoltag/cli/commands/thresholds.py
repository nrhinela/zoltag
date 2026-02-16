"""Compute keyword score thresholds from permatag-verified assets."""

import click
from datetime import datetime
from typing import Optional
from uuid import UUID

from zoltag.cli.base import CliCommand
from zoltag.metadata import MachineTag, Permatag, KeywordThreshold
from zoltag.models.config import Keyword
from zoltag.tenant_scope import tenant_column_filter


@click.command(name='compute-keyword-thresholds')
@click.option('--tenant-id', required=True, help='Tenant ID to compute thresholds for')
@click.option('--tag-type', default='siglip', show_default=True, help='MachineTag tag_type to compute thresholds for')
@click.option('--method', default='percentile', show_default=True,
              type=click.Choice(['percentile', 'separation']),
              help='Calculation method: percentile=Nth percentile of positive scores, separation=midpoint between positive/negative populations')
@click.option('--percentile', default=20, show_default=True, type=int,
              help='For percentile method: use this percentile of verified-positive scores (lower = more permissive)')
@click.option('--buffer', default=0.02, show_default=True, type=float,
              help='Subtract this buffer from the calculated threshold (adds headroom)')
@click.option('--min-samples', default=3, show_default=True, type=int,
              help='Minimum number of verified assets required to compute a threshold')
@click.option('--dry-run', is_flag=True, default=False,
              help='Print computed thresholds without writing to database')
def compute_keyword_thresholds_command(
    tenant_id: str,
    tag_type: str,
    method: str,
    percentile: int,
    buffer: float,
    min_samples: int,
    dry_run: bool,
):
    """Compute and store score thresholds for each keyword based on verified (permatag) data.

    For each keyword with enough verified positives, calculates threshold_calc
    using the chosen method. Does not overwrite threshold_manual values.
    """
    cmd = ComputeKeywordThresholdsCommand()
    cmd.run(
        tenant_id=tenant_id,
        tag_type=tag_type,
        method=method,
        percentile=percentile,
        buffer=buffer,
        min_samples=min_samples,
        dry_run=dry_run,
    )


class ComputeKeywordThresholdsCommand(CliCommand):

    def run(self, *, tenant_id, tag_type, method, percentile, buffer, min_samples, dry_run):
        self.setup_db()
        try:
            tenant = self.load_tenant(tenant_id)
            self._compute(
                tenant=tenant,
                tag_type=tag_type,
                method=method,
                percentile=percentile,
                buffer=buffer,
                min_samples=min_samples,
                dry_run=dry_run,
            )
        finally:
            self.cleanup_db()

    def _compute(self, *, tenant, tag_type, method, percentile, buffer, min_samples, dry_run):
        from uuid import UUID
        tenant_uuid = UUID(str(tenant.id))

        # Load all keywords for tenant
        keywords = self.db.query(Keyword).filter(
            tenant_column_filter(Keyword, tenant)
        ).all()
        click.echo(f"Found {len(keywords)} keywords for tenant {tenant.id}")

        # Load all permatag approvals (signum=1) for tenant, keyed by keyword_id -> set of asset_ids
        positive_permatags = self.db.query(Permatag).filter(
            Permatag.tenant_id == tenant_uuid,
            Permatag.signum == 1,
        ).all()
        positives_by_keyword = {}
        for pt in positive_permatags:
            positives_by_keyword.setdefault(pt.keyword_id, set()).add(pt.asset_id)

        # Load all permatag rejections (signum=-1) for separation method
        negative_permatags = []
        negatives_by_keyword = {}
        if method == 'separation':
            negative_permatags = self.db.query(Permatag).filter(
                Permatag.tenant_id == tenant_uuid,
                Permatag.signum == -1,
            ).all()
            for pt in negative_permatags:
                negatives_by_keyword.setdefault(pt.keyword_id, set()).add(pt.asset_id)

        updated = 0
        skipped = 0

        for kw in keywords:
            pos_asset_ids = positives_by_keyword.get(kw.id, set())
            if len(pos_asset_ids) < min_samples:
                skipped += 1
                continue

            # Fetch ML scores for positively verified assets
            pos_scores = [
                row[0] for row in self.db.query(MachineTag.confidence).filter(
                    MachineTag.tenant_id == tenant_uuid,
                    MachineTag.keyword_id == kw.id,
                    MachineTag.tag_type == tag_type,
                    MachineTag.asset_id.in_(list(pos_asset_ids)),
                    MachineTag.confidence.isnot(None),
                ).all()
            ]

            if not pos_scores:
                skipped += 1
                continue

            pos_scores_sorted = sorted(pos_scores)
            n = len(pos_scores_sorted)

            if method == 'percentile':
                idx = max(0, int(n * percentile / 100) - 1)
                raw_threshold = pos_scores_sorted[idx]
                calc_method = f'percentile_{percentile}'
            else:  # separation
                pos_median = pos_scores_sorted[n // 2]
                neg_asset_ids = negatives_by_keyword.get(kw.id, set())
                if neg_asset_ids:
                    neg_scores = [
                        row[0] for row in self.db.query(MachineTag.confidence).filter(
                            MachineTag.tenant_id == tenant_uuid,
                            MachineTag.keyword_id == kw.id,
                            MachineTag.tag_type == tag_type,
                            MachineTag.asset_id.in_(list(neg_asset_ids)),
                            MachineTag.confidence.isnot(None),
                        ).all()
                    ]
                    if neg_scores:
                        neg_scores_sorted = sorted(neg_scores)
                        neg_90th_idx = min(len(neg_scores_sorted) - 1, int(len(neg_scores_sorted) * 0.9))
                        neg_90th = neg_scores_sorted[neg_90th_idx]
                        raw_threshold = (pos_median + neg_90th) / 2
                    else:
                        raw_threshold = pos_scores_sorted[max(0, int(n * 20 / 100) - 1)]
                else:
                    # Fall back to percentile if no negatives
                    raw_threshold = pos_scores_sorted[max(0, int(n * 20 / 100) - 1)]
                calc_method = 'separation_midpoint'

            threshold_calc = max(0.0, round(raw_threshold - buffer, 4))

            click.echo(
                f"  {kw.keyword}: {calc_method}, n={n}, raw={raw_threshold:.4f}, "
                f"threshold={threshold_calc:.4f}"
                + (" [DRY RUN]" if dry_run else "")
            )

            if not dry_run:
                row = self.db.query(KeywordThreshold).filter(
                    KeywordThreshold.keyword_id == kw.id,
                    KeywordThreshold.tag_type == tag_type,
                ).first()
                if row:
                    row.threshold_calc = threshold_calc
                    row.calc_method = calc_method
                    row.calc_sample_n = n
                    row.updated_at = datetime.utcnow()
                else:
                    row = KeywordThreshold(
                        tenant_id=tenant_uuid,
                        keyword_id=kw.id,
                        tag_type=tag_type,
                        threshold_calc=threshold_calc,
                        calc_method=calc_method,
                        calc_sample_n=n,
                        updated_at=datetime.utcnow(),
                    )
                    self.db.add(row)
                updated += 1

        if not dry_run:
            self.db.commit()

        click.echo(
            f"\nDone. Updated={updated}, Skipped={skipped} "
            f"(fewer than {min_samples} verified samples)."
        )
