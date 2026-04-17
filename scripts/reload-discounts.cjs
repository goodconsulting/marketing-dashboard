const Database = require('better-sqlite3');
const db = new Database('data/stack.db');

// Category classifier
function categorize(name) {
  const l = name.toLowerCase();
  if (l.includes('sign up') || l.includes('signup') || l.includes('sign-up')) return 'new_customer';
  if (l.includes('referal') || l.includes('referral') || l.includes('refferal')) return 'new_customer';
  if (l.includes('1st time') || l.includes('first time')) return 'new_customer';
  if (l.includes('val20') || l.includes('vip discount')) return 'new_customer';
  if (l.includes('points') || l.includes('birthday') || l.includes('free delivery')) return 'loyalty';
  if (l.includes('meal deal') || l.includes('breakfast deal') || l.includes('lunch')) return 'loyalty';
  if (l.includes('app - meal') || l.includes('app - breakfast')) return 'loyalty';
  if (l.includes('momo')) return 'software_vendor';
  if (l.includes('bogo')) return 'print';
  if (l.includes('employee') || l.includes('manager comp') || l.includes('open $') || l.includes('open %')) return 'operations';
  if (l.includes('spillage') || l.includes('food quality')) return 'operations';
  if (l.includes('in-kind') || l.includes('influencer')) return 'marketing';
  if (l.includes('military') || l.includes('first responder') || l.includes('heroes') || l.includes('service 20%')) return 'loyalty';
  if (l.includes('case discount')) return 'operations';
  if (l.includes('employee meal')) return 'operations';
  if (l.includes('ubereats') || l.includes('chck 20') || l.includes('friends & family')) return 'other';
  if (l.includes('free egg bite') || l.includes('free stackwich')) return 'loyalty';
  if (l.includes('web/app')) return 'loyalty';
  if (l.includes('10% off')) return 'loyalty';
  return 'other';
}

const stmt = db.prepare(`INSERT OR REPLACE INTO fact_discount_summary
  (period, period_type, discount_name, discount_category, usage_count, discount_amount, profitability, pct_of_total_sales)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);

function insert(period, periodType, rows) {
  let count = 0;
  for (const r of rows) {
    if (!r[0] || r[0] === 'Total') continue;
    const name = r[0];
    const cat = categorize(name);
    stmt.run(period, periodType, name, cat, r[1], r[2], r[3], r[4] || 0);
    count++;
  }
  return count;
}

db.transaction(() => {
  // Q2 2025
  let c = insert('2025-Q2', 'quarter', [
    ['APP - 1000 Points - Free Smoothie', 8, 57.25, 168.41, 0],
    ['APP - Referal Offer - Free Smoothie (7.25) Existing Customer', 6, 41.25, 103.23, 0],
    ['APP - Referal Offer - Free Smoothie (7.25) New customer', 6, 43.50, 72.99, 0],
    ['APP - SIgn up offer Free Smoothie (7.25 )', 3, 21.75, 10.99, 0],
    ['BOGO Card', 26, 182.50, 329.50, 0],
    ['Employee Discount - Item', 24, 49.87, 402.88, 0],
    ['Manager Comp - Item', 3, 24.49, 62.69, 0],
    ['Military/First Responder Discount', 16, 22.45, 462.27, 0],
    ["Momo's 20% off", 49, 82.45, 1170.41, 0],
    ['Open $ Item', 5, 20.42, 262.93, 0],
    ['Open % Item', 84, 519.16, 1340.03, 0],
    ['Sign Up Offer - Free Smoothie', 1, 7.25, 1.50, 0],
    ['Employee Discount - Check', 213, 649.81, 1521.32, 0],
    ['Open $ Check', 3, 15.54, 101.09, 0],
    ['Meal Deal', 2711, 5168.83, 66358.30, 0],
    ['Open % Check', 142, 465.73, 2538.37, 0],
    ['10% off all in-store products', 49, 78.45, 710.94, 0],
  ]);
  console.log('Q2 2025:', c, 'rows');

  // Q3 2025
  c = insert('2025-Q3', 'quarter', [
    ['1000 Points = Free Smoothie', 86, 621.25, 640.65, 0],
    ['APP - 1000 Points - Free Smoothie', 78, 561.50, 685.50, 0],
    ['APP - Birthday Offer - Free Smoothie', 88, 631.25, 423.43, 0],
    ['APP - Breakfast Deal', 16, 20.00, 175.84, 0],
    ['APP - Meal Deal', 363, 816.75, 7729.99, 0],
    ['APP - Referal Offer - Free Smoothie (7.25) Existing Customer', 51, 368.25, 137.37, 0],
    ['APP - Referal Offer - Free Smoothie (7.25) New customer', 99, 712.50, 315.07, 0],
    ['APP - Sign up offer Free Smoothie (7.25 )', 447, 3205.50, 2399.92, 0],
    ['APP - SIgn up offer Free Smoothie (7.25 )', 13, 93.50, 61.20, 0],
    ['Birthday Offer - Free Smoothie', 53, 382.00, 291.24, 0],
    ['BOGO Card', 59, 413.50, 585.02, 0],
    ['Breakfast Deal - $10.99', 3, 3.75, 32.97, 0],
    ['Case Discount (20%)', 38, 323.21, 2179.31, 0],
    ['Employee Discount - Item', 167, 415.92, 1491.36, 0],
    ['Employee Meal 100%', 379, 3571.56, 184.33, 0],
    ['Manager Comp - Item', 36, 327.41, 168.25, 0],
    ['Meal Deal', 6571, 13991.32, 160933.57, 0],
    ['Meal Deal - $14.99', 24, 54.00, 474.19, 0],
    ['Military/First Responder Discount', 16, 12.71, 303.70, 0],
    ["Momo's 20% off", 86, 145.80, 1243.74, 0],
    ['Open $ Item', 10, 46.96, 165.22, 0],
    ['Open % Item', 198, 1198.35, 3214.03, 0],
    ['Referral Offer - Free Smoothie ($7.25 Value)', 17, 122.50, 73.65, 0],
    ['Refferal Offer - New sign up ($7.25 Value)', 23, 164.50, 58.02, 0],
    ['Sign Up Offer - Free Smoothie', 738, 5297.75, 3594.23, 0],
    ['Spillage/Food Quality - Item', 43, 355.83, 7.25, 0],
    ['Manager Comp - Check', 27, 321.26, 0, 0],
    ['App - Free Delivery ($3.99)', 14, 55.86, 698.99, 0],
    ['Open $ Check', 17, 231.50, 1231.34, 0],
    ['Employee Discount - Check', 548, 1502.03, 3515.74, 0],
    ['Breakfast Deal', 41, 50.84, 654.63, 0],
    ['Open % Check', 267, 1078.49, 2755.55, 0],
    ['10% off all in-store products', 81, 168.15, 1526.80, 0],
    ['Service 20% - Heroes', 215, 827.44, 3330.06, 0],
  ]);
  console.log('Q3 2025:', c, 'rows');

  // Q4 2025
  c = insert('2025-Q4', 'quarter', [
    ['1000 Points = Free Smoothie', 417, 3042.30, 3913.23, 0.006],
    ['APP - 1000 Points - Free Smoothie', 283, 2040.25, 2604.71, 0.004],
    ['APP - Birthday Offer - Free Smoothie', 124, 892.25, 540.41, 0.002],
    ['APP - Breakfast Deal', 95, 118.75, 1323.47, 0],
    ['APP - FREE Egg Bite with Protein Coffee', 9, 44.91, 67.47, 0],
    ['APP - FREE Stackwich with Protein Coffee', 78, 623.22, 403.67, 0.001],
    ['APP - Meal Deal', 615, 1383.75, 12699.71, 0.003],
    ['APP - Referal Offer - Free Smoothie (7.25) Existing Customer', 33, 237.00, 112.08, 0],
    ['APP - Referal Offer - Free Smoothie (7.25) New customer', 67, 483.25, 226.25, 0.001],
    ['APP - Sign up offer Free Smoothie (7.25 )', 593, 4257.75, 3477.37, 0.008],
    ['Birthday Offer - Free Smoothie', 119, 869.69, 778.64, 0.002],
    ['BOGO Card', 57, 406.93, 586.77, 0.001],
    ['Breakfast Deal - $10.99', 27, 33.75, 423.91, 0],
    ['Case Discount (20%)', 7, 64.66, 430.92, 0],
    ['Employee Discount - Item', 198, 356.73, 1607.21, 0.001],
    ['Employee Meal 100%', 392, 3698.86, 104.73, 0.007],
    ['Free Egg Bite with Any Protein Coffee', 6, 29.94, 35.88, 0],
    ['FREE STACKWICH with purchase of any Protein Coffee', 25, 201.00, 256.75, 0],
    ['Manager Comp - Item', 200, 1798.03, 1307.34, 0.003],
    ['Meal Deal - $14.99', 80, 180.00, 1654.51, 0],
    ['Meal Deal - Save $2.25', 15, 33.75, 294.42, 0],
    ['Meal Deal - Save $4.99', 1, 4.99, 27.73, 0],
    ["Momo's 20% off", 24, 40.70, 258.56, 0],
    ['Open $ Item', 9, 114.38, 2210.90, 0],
    ['Open % Item', 173, 1067.12, 4915.58, 0.002],
    ['Referral Offer - Free Smoothie ($7.25 Value)', 18, 130.50, 100.32, 0],
    ['Referral Offer - Free Smoothie ($8.99 Value)', 4, 28.25, 11.88, 0],
    ['Referral Offer - New sign up ($8.99 Value)', 1, 7.25, 0, 0],
    ['Refferal Offer - New sign up ($7.25 Value)', 12, 86.25, 48.41, 0],
    ['Sign Up Offer - Free Smoothie', 645, 4801.79, 4260.94, 0.009],
    ['Spillage/Food Quality - Item', 51, 457.11, 0, 0.001],
    ['100% OFF IN-KIND MARKETING', 50, 1485.23, 0, 0.003],
    ['Manager Comp - Check', 578, 11591.30, 0, 0.021],
    ['App - Free Delivery ($3.99)', 23, 87.78, 1120.69, 0],
    ['Open $ Check', 18, 750.58, 1889.69, 0.001],
    ['Employee Discount - Check', 397, 1223.56, 2864.85, 0.002],
    ['Meal Deal (Kiosk)', 4, 9.00, 61.76, 0],
    ['Breakfast Deal', 163, 203.58, 2761.82, 0],
    ['Meal Deal', 3724, 8450.22, 104689.52, 0.016],
    ['Open % Check', 167, 1979.65, 1758.12, 0.004],
    ['10% off all in-store products', 38, 64.39, 584.47, 0],
    ['Service 20% - Heroes', 169, 608.55, 2443.99, 0.001],
  ]);
  console.log('Q4 2025:', c, 'rows');

  // Jan 2026
  c = insert('2026-01', 'month', [
    ['1000 Points = Free Smoothie', 239, 1984.87, 2332.84, 0.008],
    ['APP - 1000 Points - Free Smoothie', 134, 1108.17, 1353.06, 0.004],
    ['APP - Birthday Offer - Free Smoothie', 58, 491.42, 284.42, 0.002],
    ['APP - Breakfast Deal', 16, 20.00, 235.22, 0],
    ['APP - Meal Deal', 2, 8.50, 34.94, 0],
    ['APP - Referal Offer - Free Smoothie (8.99) Existing Customer', 16, 136.59, 28.72, 0.001],
    ['APP - Referal Offer - Free Smoothie (8.99) New customer', 15, 126.85, 65.19, 0],
    ['APP - Sign up offer Free Smoothie (7.25 )', 2, 14.50, 17.21, 0],
    ['APP - Sign up offer Free Smoothie (8.99)', 554, 4829.21, 2929.26, 0.019],
    ['Birthday Offer - Free Smoothie', 77, 642.23, 383.03, 0.003],
    ['BOGO Card', 35, 290.67, 423.95, 0.001],
    ['Breakfast Deal - $10.99', 19, 23.75, 307.24, 0],
    ['Case Discount (20%)', 1, 8.38, 53.00, 0],
    ['Employee Discount - Item', 78, 220.90, 738.32, 0.001],
    ['Employee Meal 100%', 112, 1135.01, 17.66, 0.004],
    ['Manager Comp - Item', 68, 628.32, 231.74, 0.002],
    ['Meal Deal - Save $2.99', 5, 14.95, 97.48, 0],
    ['Meal Deal - Save $4.99', 3, 14.97, 63.60, 0],
    ["Momo's 20% off", 7, 11.40, 88.45, 0],
    ['Open % Item', 113, 1589.99, 18393.29, 0.006],
    ['Referral Offer - Free Smoothie ($8.99 Value)', 19, 165.56, 146.14, 0.001],
    ['Referral Offer - New sign up ($8.99 Value)', 14, 117.86, 53.20, 0],
    ['Sign Up Offer - Free Smoothie', 473, 4116.03, 3314.24, 0.016],
    ['Spillage/Food Quality - Item', 14, 136.12, 0, 0.001],
    ['Web/app - meal deal central iowa', 39, 194.61, 807.69, 0.001],
    ['Web/app - meal deal Eastern iowa', 233, 696.67, 4549.11, 0.003],
    ['100% OFF IN-KIND MARKETING', 4, 440.71, 0, 0.002],
    ['Manager Comp - Check', 83, 1591.19, 0, 0.006],
    ['App - Free Delivery ($3.99)', 6, 23.94, 330.68, 0],
    ['Open $ Check', 8, 69.79, 116.82, 0],
    ['Employee Discount - Check', 170, 547.96, 1282.75, 0.002],
    ['Meal Deal (Kiosk)', 19, 77.81, 364.10, 0],
    ['Breakfast Deal', 91, 113.75, 1518.61, 0],
    ['Meal Deal', 1933, 8385.19, 46233.92, 0.033],
    ['Open % Check', 59, 242.49, 635.82, 0.001],
    ['10% off all in-store products', 17, 27.63, 252.66, 0],
    ['Service 20% - Heroes', 80, 271.92, 1098.47, 0.001],
  ]);
  console.log('Jan 2026:', c, 'rows');

  // Feb 2026
  c = insert('2026-02', 'month', [
    ['1000 Points = Free Smoothie', 250, 2088.02, 2454.67, 0.009],
    ['100% OFF IN-KIND MARKETING', 66, 840.16, 12.02, 0.004],
    ['10% off all in-store products', 13, 13.53, 132.43, 0],
    ['APP - 1000 Points - Free Smoothie', 137, 1147.63, 1173.15, 0.005],
    ['APP - Birthday Offer - Free Smoothie', 78, 654.74, 307.40, 0.003],
    ['APP - Breakfast Deal', 14, 17.50, 253.94, 0],
    ['APP - Referal Offer - Free Smoothie (8.99) Existing Customer', 20, 168.80, 52.70, 0.001],
    ['APP - Referal Offer - Free Smoothie (8.99) New customer', 15, 121.37, 22.98, 0.001],
    ['APP - Sign up offer Free Smoothie (8.99)', 428, 3677.47, 2389.35, 0.016],
    ['Birthday Offer - Free Smoothie', 63, 541.12, 462.75, 0.002],
    ['BOGO Card', 84, 718.41, 1036.15, 0.003],
    ['Breakfast Deal - $10.99', 1, 1.25, 10.99, 0],
    ['Breakfast Deal - $1.25 off', 13, 16.25, 188.18, 0],
    ['Case Discount (20%)', 7, 64.66, 594.25, 0],
    ['Employee Discount - Item', 83, 194.37, 721.31, 0.001],
    ['Employee Meal 100%', 71, 685.96, 26.73, 0.003],
    ['Manager Comp - Item', 35, 587.48, 185.17, 0.002],
    ['Meal Deal - Save $2.99', 2, 5.98, 74.72, 0],
    ['Meal Deal - Save $3.99', 3, 11.97, 39.75, 0],
    ['Meal Deal - Save $4.99', 2, 9.98, 14.99, 0],
    ["Momo's 20% off", 25, 50.85, 544.55, 0],
    ['Open % Item', 67, 504.90, 1038.79, 0.002],
    ['Referral Offer - Free Smoothie ($8.99 Value)', 16, 132.10, 106.47, 0.001],
    ['Referral Offer - New sign up ($8.99 Value)', 12, 99.14, 50.20, 0],
    ['Service 20% - Heroes', 36, 66.58, 456.54, 0],
    ['Sign Up Offer - Free Smoothie', 347, 2989.03, 2895.65, 0.013],
    ['Spillage/Food Quality - Item', 4, 40.96, 0, 0],
    ['VAL20', 21, 44.10, 311.81, 0],
    ['VIP Discount - 20% Off', 2, 3.40, 21.57, 0],
    ['Web/app - meal deal central iowa', 42, 209.58, 848.67, 0.001],
    ['Web/app - meal deal Eastern iowa', 264, 945.36, 5912.14, 0.004],
    ['CHCK 20', 29, 104.03, 417.77, 0],
    ['Stack Influencer Program', 1, 23.00, 9.97, 0],
    ['Friends & Family Discount - 20% OFF', 1, 3.06, 11.42, 0],
    ['App - Free Delivery ($3.99)', 9, 35.91, 536.96, 0],
    ['Breakfast Deal (Kiosk)', 1, 1.25, 18.98, 0],
    ['Employee Discount - Check', 151, 450.52, 1052.41, 0.002],
    ['Meal Deal - Eastern Iowa', 1167, 4723.33, 27805.13, 0.020],
    ['Stack Influencer Program.', 1, 15.48, 0, 0],
    ['Manager Comp - Check', 22, 387.62, 0, 0.002],
    ['Meal Deal - Central Iowa', 404, 2025.96, 10932.38, 0.009],
    ['Open $ Check', 7, 34.95, 51.48, 0],
    ['UberEats PERCENTOFF', 14, 98.67, 302.44, 0],
    ['Meal Deal (Kiosk)', 22, 91.78, 487.57, 0],
    ['Breakfast Deal', 67, 83.75, 1310.07, 0],
    ['Meal Deal', 136, 577.64, 3357.37, 0.002],
    ['Open % Check', 74, 407.66, 1474.28, 0.002],
  ]);
  console.log('Feb 2026:', c, 'rows');
})();

// Verify totals
const totals = db.prepare(`
  SELECT period, COUNT(*) as rows, SUM(usage_count) as total_count,
    ROUND(SUM(discount_amount), 2) as total_discount, ROUND(SUM(profitability), 2) as total_profit
  FROM fact_discount_summary GROUP BY period ORDER BY period
`).all();
console.log('\nVerification:');
totals.forEach(t => console.log(`  ${t.period}: ${t.rows} rows, ${t.total_count} uses, $${t.total_discount} discount, $${t.total_profit} profit`));

db.close();
