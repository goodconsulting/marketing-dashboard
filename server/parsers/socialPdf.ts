/**
 * Hello Digital Marketing monthly social PDF parser (upload-pipeline wrapper).
 *
 * The text-grid parsing core lives in server/lib/social-pdf.cjs, shared with
 * scripts/ingest-social.cjs. This wrapper extracts the PDF text layer and maps
 * records to the camelCase SocialMonthly shape.
 *
 * The report grid has month names but NO year — callers pass one (upload flow
 * defaults to the current year, overridable via the month hint).
 */
import { PDFParse } from 'pdf-parse';
import { parseSocialReportText } from '../lib/social-pdf.cjs';
import type { SocialMonthly } from '../types.ts';

export async function parseSocialPdf(buffer: Buffer, year: string): Promise<SocialMonthly[]> {
  const parser = new PDFParse({ data: buffer });
  const { text } = await parser.getText();
  const { records } = parseSocialReportText(text, year);
  return records.map(r => ({
    month: r.month,
    platform: r.platform,
    followers: r.followers,
    engagement: r.engagement,
    impressions: r.impressions,
    reach: r.reach,
    profileVisits: r.profile_visits,
    websiteClicks: r.website_clicks,
  }));
}
