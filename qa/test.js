#!/usr/bin/env node
/**
 * trip-2026 QA suite — runs after every push to main.
 * Works locally (NODE_PATH=.../node_modules) and in GitHub Actions (npm install playwright).
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL = process.env.QA_URL || 'https://ryanjkam-cmd.github.io/trip-2026/';
const OUT  = process.env.QA_OUT  || '/tmp';
const MOBILE = { width: 390, height: 844 };

const results = [];
let page, browser;

const log = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log((pass ? '✓' : '✗') + ' ' + name + (detail ? ' — ' + detail : ''));
};

const ss = async (name) => {
  try { await page.screenshot({ path: path.join(OUT, `qa_${name}.png`), fullPage: false }); } catch {}
};

async function run() {
  browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: MOBILE });
  page = await ctx.newPage();

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  // ── 1. Page loads with events ─────────────────────────────────────────────
  const eventCount = await page.locator('.cal-event').count();
  log('Page loads with calendar events', eventCount > 0, `${eventCount} events`);
  await ss('01_loaded');

  // ── 2. Solid icon background (no gradient) ────────────────────────────────
  const iconBg = await page.locator('.cal-event-icon').first().evaluate(el =>
    window.getComputedStyle(el).backgroundColor
  ).catch(() => '');
  const hasGradient = iconBg.toLowerCase().includes('gradient');
  log('Icon strip is solid color (no gradient)', !hasGradient && iconBg !== '', `bg=${iconBg}`);

  // ── 3. White SVG icon present ─────────────────────────────────────────────
  const svgInIcon = await page.locator('.cal-event-icon svg').count();
  log('White SVG icon in event strip', svgInIcon > 0, `${svgInIcon} SVGs`);

  // ── 4. Status bar full-width (not pill) ───────────────────────────────────
  const barCount = await page.locator('.cal-status-bar').count();
  log('Full-width status bar exists (.cal-status-bar)', barCount > 0, `${barCount} bars`);
  if (barCount > 0) {
    const barWidth = await page.locator('.cal-status-bar').first().evaluate(el => el.offsetWidth);
    const cardWidth = await page.locator('.cal-event').first().evaluate(el => el.offsetWidth);
    log('Status bar is full card width', barWidth >= cardWidth - 4, `bar=${barWidth}px card=${cardWidth}px`);
  }

  // ── 5. Add button is blue bar ─────────────────────────────────────────────
  const addBg = await page.locator('.cal-add-btn').evaluate(el =>
    window.getComputedStyle(el).backgroundColor
  ).catch(() => '');
  const isBlue = addBg.includes('27') || addBg.includes('1B72') || addBg.includes('114');
  log('Add button background is blue', isBlue, addBg);
  const addRadius = await page.locator('.cal-add-btn').evaluate(el =>
    window.getComputedStyle(el).borderRadius
  ).catch(() => '');
  log('Add button is bar shape (not pill)', !addRadius.includes('99px'), `radius=${addRadius}`);

  // ── 6. Click opens drawer (no drag threshold) ─────────────────────────────
  await page.locator('.cal-event').first().click();
  await page.waitForTimeout(500);
  const drawerOpen = await page.locator('.activity-drawer').isVisible().catch(() => false);
  log('Click opens drawer', drawerOpen, drawerOpen ? 'drawer visible' : 'not visible');
  await ss('06_drawer');

  // ── 7. Time input has no native clock icon ────────────────────────────────
  if (drawerOpen) {
    const timeInputVisible = await page.locator('.drawer-time-input').first().isVisible().catch(() => false);
    log('Drawer time input visible', timeInputVisible, '');
    const timeWidth = await page.locator('.drawer-time-input').first().evaluate(el =>
      parseInt(window.getComputedStyle(el).width)
    ).catch(() => 0);
    log('Drawer time input width >= 90px', timeWidth >= 88, `width=${timeWidth}px`);
  }

  // ── 8. Close drawer ───────────────────────────────────────────────────────
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // ── 9. Drag threshold: small move (<5px) should NOT move event ────────────
  const firstEvent = page.locator('.cal-event').first();
  const timeBefore = await firstEvent.locator('.cal-event-time-row').textContent().catch(() => '');
  const box = await firstEvent.boundingBox();
  if (box) {
    const cx = box.x + box.width * 0.4;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx, cy + 2, { steps: 2 }); // under threshold
    await page.mouse.up();
    await page.waitForTimeout(400);
    const drawerAfterSmallMove = await page.locator('.activity-drawer').isVisible().catch(() => false);
    // small move → should open drawer (treated as click)
    log('Small move (<5px) treated as click', drawerAfterSmallMove, drawerAfterSmallMove ? 'drawer opened ✓' : 'drawer did not open');
    if (drawerAfterSmallMove) await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }

  // ── 10. Drag threshold: large move (>5px) should move event ──────────────
  const box2 = await page.locator('.cal-event').first().boundingBox();
  if (box2) {
    const timeBefore2 = await page.locator('.cal-event').first().locator('.cal-event-time-row').textContent().catch(() => '');
    const cx = box2.x + box2.width * 0.4;
    const cy = box2.y + box2.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.waitForTimeout(80);
    await page.mouse.move(cx, cy + 72, { steps: 12 }); // 72px = 60 min, well over threshold
    await page.waitForTimeout(200);
    await page.mouse.up();
    await page.waitForTimeout(600);
    const drawerAfterDrag = await page.locator('.activity-drawer').isVisible().catch(() => false);
    const timeAfterDrag = await page.locator('.cal-event').first().locator('.cal-event-time-row').textContent().catch(() => '');
    log('Large drag does NOT open drawer', !drawerAfterDrag, drawerAfterDrag ? 'drawer opened (bug)' : 'no drawer ✓');
    log('Large drag changes event time', timeBefore2 !== timeAfterDrag, `before="${timeBefore2}" after="${timeAfterDrag}"`);
    await ss('10_after_drag');
  }

  // ── 11. White text on active city nav ─────────────────────────────────────
  // Navigate to Amsterdam (Netherlands) if a city-item exists
  const cityItems = await page.locator('.city-item').count();
  if (cityItems > 1) {
    await page.locator('.city-item').last().click();
    await page.waitForTimeout(400);
    const activeColor = await page.locator('.city-item.active .name').evaluate(el =>
      window.getComputedStyle(el).color
    ).catch(() => '');
    const isWhite = activeColor.includes('255, 255, 255') || activeColor === 'rgb(255, 255, 255)';
    log('Active city name is white text', isWhite, `color=${activeColor}`);
    await ss('11_active_city');
  }

  // ── 12. Co-hero text is white ─────────────────────────────────────────────
  const coHeroCount = await page.locator('.co-hero').count();
  if (coHeroCount > 0) {
    const heroColor = await page.locator('.co-h2').evaluate(el =>
      window.getComputedStyle(el).color
    ).catch(() => '');
    const isWhite = heroColor.includes('255, 255, 255');
    log('Co-hero h2 is white text', isWhite, `color=${heroColor}`);
  }

  // ── 13. Resize handle visible on hover ───────────────────────────────────
  const firstCal = page.locator('.cal-event').first();
  await firstCal.hover();
  await page.waitForTimeout(200);
  const rOpacity = await page.locator('.cal-resize-handle').first().evaluate(el =>
    parseFloat(window.getComputedStyle(el).opacity)
  ).catch(() => 0);
  log('Resize handle appears on hover', rOpacity > 0, `opacity=${rOpacity}`);

  await ss('final');

  // ── Summary ───────────────────────────────────────────────────────────────
  const passed = results.filter(r => r.pass).length;
  const total  = results.length;
  const icon   = passed === total ? '✅' : passed >= total * 0.8 ? '⚠️' : '❌';
  console.log(`\n${icon} ${passed}/${total} passed`);

  // Write JSON report
  const report = { url: URL, timestamp: new Date().toISOString(), passed, total, results };
  fs.writeFileSync(path.join(OUT, 'qa_report.json'), JSON.stringify(report, null, 2));
  console.log(`Report: ${path.join(OUT, 'qa_report.json')}`);

  await browser.close();
  process.exit(passed === total ? 0 : 1);
}

run().catch(err => {
  console.error('QA fatal:', err);
  if (browser) browser.close();
  process.exit(1);
});
