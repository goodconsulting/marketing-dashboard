/**
 * Type declarations for social-pdf.cjs (Hello Digital PDF text parser core).
 */

export interface SocialReportRecord {
  month: string;                       // 'YYYY-MM'
  platform: 'facebook' | 'instagram';
  followers: number;
  engagement: number;
  impressions: number;
  reach: number;
  profile_visits: number;
  website_clicks: number;
}

export declare const KPI_COLUMNS: Record<string, string>;

export declare function parseSocialReportText(
  text: string,
  year: number | string,
): { platform: 'facebook' | 'instagram'; records: SocialReportRecord[] };
