/**
 * Centralized color theme for the Stack Wellness Cafe marketing dashboard.
 *
 * ALL chart colors, brand colors, and domain-specific palettes live here.
 * Tailwind arbitrary-value classes (bg-[#2D5A3D]) are NOT migrated — they
 * reference the same hex values but live in the CSS/HTML layer.
 *
 * CSS custom properties in index.css (--stack-green, etc.) remain as a
 * parallel reference for potential future Tailwind @theme integration.
 */
import type { JourneyStage, MenuIntelligenceItem } from '../types';

// ─── Brand Palette ──────────────────────────────────────────────────
export const BRAND = {
  green:      '#2D5A3D',
  greenLight: '#4A7C5C',
  meadow:     '#7CB342',
  linen:      '#F5F0E8',
  dark:       '#1A1A2E',
} as const;

// ─── Semantic / Status Colors ───────────────────────────────────────
export const STATUS = {
  success: '#10b981',
  danger:  '#ef4444',
  warning: '#f59e0b',
  info:    '#3b82f6',
  purple:  '#8b5cf6',
} as const;

// ─── Chart Infrastructure ───────────────────────────────────────────
export const CHART = {
  grid:        '#f0f0f0',
  gridDark:    '#e5e7eb',
  muted:       '#d1d5db',
  lightGreen:  '#dcfce7',
  lightBlue:   '#60a5fa',
  neutralBar:  '#e5e7eb',
} as const;

// ─── Recharts-Friendly Palette (ordered for multi-series charts) ────
export const PALETTE = [
  BRAND.green,
  STATUS.warning,
  STATUS.purple,
  STATUS.info,
  STATUS.success,
  STATUS.danger,
] as const;

// ─── Domain-Specific Color Maps ─────────────────────────────────────

/** CRM Journey Stage → Color */
export const SEGMENT_COLORS: Record<JourneyStage, string> = {
  WHALE:    BRAND.green,
  LOYALIST: BRAND.greenLight,
  REGULAR:  BRAND.meadow,
  ROOKIE:   CHART.lightBlue,
  CHURNED:  STATUS.danger,
  SLIDER:   STATUS.warning,
  UNKNOWN:  CHART.muted,
};

/** Stack Location → Color */
export const LOCATION_COLORS: Record<string, string> = {
  Coralville:      BRAND.green,
  Edgewood:        BRAND.greenLight,
  'Downtown CR':   BRAND.meadow,
  Fountains:       STATUS.warning,
  Waukee:          STATUS.purple,
};
export const DEFAULT_LOCATION_COLOR = '#6b7280';

/** Menu BCG Quadrant → Color */
export const QUADRANT_COLORS: Record<MenuIntelligenceItem['menuQuadrant'], string> = {
  star:       BRAND.green,
  plow_horse: STATUS.warning,
  puzzle:     STATUS.purple,
  dog:        STATUS.danger,
};
