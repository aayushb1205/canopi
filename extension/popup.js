/* ═══════════════════════════════════════════════
   canopi Popup v3 — Consumer-first design
   Trust score ring → plain-English claims → detail
   ═══════════════════════════════════════════════ */

const $ = id => document.getElementById(id);
const show = id => {
  document.querySelectorAll('.view').forEach(el => el.style.display = 'none');
  $(id).style.display = 'block';
};
const esc = t => { const d = document.createElement('div'); d.textContent = t || ''; return d.innerHTML; };
const trunc = (t, n) => t && t.length > n ? t.slice(0, n) + '…' : (t || '');

// Color for trust score — stricter thresholds
const scoreColor = s => s >= 75 ? '#2D6A4F' : s >= 55 ? '#B68D40' : s >= 35 ? '#E07B39' : '#C1121F';
const scoreWord = s => s >= 75 ? 'Trustworthy' : s >= 55 ? 'Some concerns' : s >= 35 ? 'Caution advised' : 'Likely greenwashing';

// Store result for switching views
let lastResult = null;

// ── Scan ────────────────────────────────────────

async function scan() {
  show('v-scan');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return err('No active tab found.');
    chrome.tabs.sendMessage(tab.id, { action: 'scan' }, r => {
      if (chrome.runtime.lastError) return err('Refresh the page and try again.');
      if (!r) return err('No response from page.');
      if (r.error) return err(r.message || 'Scan failed.');
      lastResult = r;
      renderConsumer(r);
    });
  } catch (e) { err(e.message); }
}

function err(msg) {
  $('err-msg').textContent = msg;
  show('v-err');
}

// ── Consumer View ───────────────────────────────

function renderConsumer(d) {
  const ts = d.trust_score ?? 50;
  const color = scoreColor(ts);

  // Animate ring
  const ring = $('r-ring');
  const dashLen = (ts / 100) * 326.7;
  ring.style.stroke = color;
  // Small delay so transition fires
  requestAnimationFrame(() => {
    ring.setAttribute('stroke-dasharray', `${dashLen} 326.7`);
  });

  // Number
  $('r-num').textContent = ts;
  $('r-num').style.color = color;

  // Label — override if brand has serious known issues
  const bc = d.brand_context;
  const seriousIssues = bc?.known_issues?.some(i =>
    /forced labor|child labor|labour exploitation|labor violation/i.test(i)
  );
  if (seriousIssues && ts >= 55) {
    $('r-label').textContent = 'Caution advised';
    $('r-label').style.color = '#E07B39';
  } else {
    $('r-label').textContent = scoreWord(ts);
    $('r-label').style.color = color;
  }

  // Summary
  const hasClaims = d.claims?.length > 0;
  if (d.summary) {
    $('r-summary').textContent = d.summary;
  } else if (!hasClaims && ts >= 55) {
    $('r-summary').textContent = `No ECGT or FTC violations found on this page, though the brand's overall environmental credentials are ${bc?.transparency_tier || 'unknown'}.`;
  } else if (!hasClaims) {
    $('r-summary').textContent = `No specific violations found on this page, but the brand has limited transparency overall.`;
  } else {
    $('r-summary').textContent = d.score_label;
  }

  // Pills
  const pills = $('r-pills');
  pills.innerHTML = '';
  const banned = d.banned_claims || 0;
  const restricted = d.restricted_claims || 0;
  const certs = (d.certifications_found || []).length;

  if (banned > 0) pills.innerHTML += `<span class="pill pill-red">${banned} banned claim${banned !== 1 ? 's' : ''}</span>`;
  if (restricted > 0) pills.innerHTML += `<span class="pill pill-amb">${restricted} need${restricted === 1 ? 's' : ''} proof</span>`;
  if (certs > 0) pills.innerHTML += `<span class="pill pill-grn">${certs} cert${certs !== 1 ? 's' : ''} found</span>`;

  // Brand context
  const brandBox = $('r-brand');
  if (bc) {
    brandBox.style.display = 'block';
    const tier = bc.transparency_tier || 'unknown';
    const tierLabel = bc.transparency_tier_label || 'Unknown';

    let signalsHtml = '';
    if (bc.known_brand) {
      const sigs = [];
      if (bc.b_corp) sigs.push('<span class="brand-sig pos">B Corp</span>');
      if (bc.fair_wear) sigs.push('<span class="brand-sig pos">Fair Wear</span>');
      if (bc.sbti_validated) sigs.push('<span class="brand-sig pos">SBTi validated</span>');
      else if (bc.sbti) sigs.push('<span class="brand-sig neutral">SBTi committed</span>');
      if (bc.publishes_supplier_list) sigs.push('<span class="brand-sig pos">Supplier list published</span>');
      if (bc.publishes_impact_report) sigs.push('<span class="brand-sig pos">Impact report</span>');
      if (bc.third_party_certs?.length)
        sigs.push(...bc.third_party_certs.slice(0, 4).map(c =>
          `<span class="brand-sig pos">${esc(c)}</span>`
        ));
      if (bc.third_party_certs?.length > 4)
        sigs.push(`<span class="brand-sig neutral">+${bc.third_party_certs.length - 4} more</span>`);
      if (!bc.b_corp && !bc.fair_wear && !bc.sbti && !bc.third_party_certs?.length)
        sigs.push('<span class="brand-sig neg">No third-party certs</span>');
      signalsHtml = `<div class="brand-signals">${sigs.join('')}</div>`;
    }

    let issuesHtml = '';
    if (bc.known_issues?.length) {
      issuesHtml = `<div class="brand-issues">${
        bc.known_issues.slice(0, 3).map(i =>
          `<div class="brand-issue">${esc(i)}</div>`
        ).join('')
      }</div>`;
    }

    brandBox.innerHTML = `
      <div class="brand-card">
        <div class="brand-hd">
          <div class="brand-nm">${esc(bc.display_name || d.brand_name || 'Unknown brand')}</div>
          <span class="brand-tier ${tier}">${tierLabel}</span>
        </div>
        <div class="brand-summary">${esc(bc.brand_summary || '')}</div>
        ${signalsHtml}
        ${issuesHtml}
      </div>`;
  } else {
    brandBox.style.display = 'none';
  }

  // Consumer claims
  const box = $('r-claims');
  box.innerHTML = '';
  if (d.claims?.length) {
    d.claims.forEach(c => {
      const el = document.createElement('div');
      el.className = `cc ${c.severity === 'banned' ? 'ban' : 'res'}`;
      el.onclick = () => el.classList.toggle('open');

      const consumerText = c.consumer_label || c.description;
      const sevLabel = c.severity === 'banned' ? 'Banned under EU law' : 'Unverified claim';

      let goodHtml = '';
      if (c.remediation?.compliant_alternatives?.[0]) {
        goodHtml = `
          <div class="cc-good">
            <div class="cc-good-lbl">What a good claim looks like</div>
            <div class="cc-good-txt">${esc(c.remediation.compliant_alternatives[0])}</div>
          </div>`;
      }

      el.innerHTML = `
        <div class="cc-top">
          <span class="cc-dot"></span>
          <div class="cc-bd">
            <div class="cc-text">${esc(consumerText)}</div>
            <span class="cc-sev">${sevLabel}</span>
          </div>
          <span class="cc-chev">▶</span>
        </div>
        <div class="cc-detail">
          <div class="cc-what-lbl">What this means</div>
          <div class="cc-what">${esc(c.remediation?.guidance || c.description)}</div>
          ${goodHtml}
        </div>`;

      box.appendChild(el);
    });
  }

  // Clean-state certs (and site-crawled certs)
  const certsClean = $('r-certs-clean');
  const allCerts = d.certifications_found || [];
  if (allCerts.length > 0) {
    certsClean.style.display = 'block';
    certsClean.innerHTML = '<div class="certs-title">Certifications found</div>';
    allCerts.forEach(c => {
      const v = c.verified;
      const fromSite = c.source === 'site_crawl';
      const fromDb = c.source === 'brand_database';
      const statusText = v ? 'Verified' : (fromDb ? 'Brand cert' : (fromSite ? 'Found on site' : 'Mentioned'));
      const statusClass = v ? 'v' : (fromDb ? 'v' : 'u');
      certsClean.innerHTML += `
        <div class="cert-row">
          <span class="cert-dot ${statusClass}"></span>
          <span class="cert-nm">${esc(c.certification_name)}${fromSite ? ' *' : ''}</span>
          <span class="cert-st ${statusClass}">${statusText}</span>
        </div>`;
    });

    // Show source note
    const siteCerts = allCerts.filter(c => c.source === 'site_crawl');
    const dbCerts = allCerts.filter(c => c.source === 'brand_database');
    if (siteCerts.length > 0) {
      const crawlInfo = d.site_crawl || {};
      certsClean.innerHTML += `
        <div style="font-size:9px;color:#9B9B9B;padding:6px 2px 0;line-height:1.4">
          * Found on brand sustainability pages (${crawlInfo.pages_scanned || 0} pages checked)
        </div>`;
    }
    if (dbCerts.length > 0) {
      certsClean.innerHTML += `
        <div style="font-size:9px;color:#9B9B9B;padding:6px 2px 0;line-height:1.4">
          Certifications from canopi brand database — verified from public sources
        </div>`;
    }
  } else {
    certsClean.style.display = 'none';
  }

  show('v-result');
}

// ── B2B Detail View ─────────────────────────────

function renderDetail(d) {
  $('d-url').textContent = (d.url || '').replace(/^https?:\/\//, '');

  const box = $('d-claims');
  box.innerHTML = '';

  if (d.claims?.length) {
    d.claims.forEach(c => {
      const el = document.createElement('div');
      el.className = `dc ${c.severity === 'banned' ? 'ban' : 'res'}`;

      const top = document.createElement('div');
      top.className = 'dc-top';
      top.onclick = () => el.classList.toggle('open');

      const jurisdictions = c.jurisdictions || ['EU'];
      const jurisTags = jurisdictions.map(j =>
        `<span class="dc-tag ${j.toLowerCase()}">${j}</span>`
      ).join('');
      const sevTag = c.severity === 'banned'
        ? '<span class="dc-tag sb">Banned</span>'
        : '<span class="dc-tag sr">Needs evidence</span>';

      const refs = [];
      if (c.ecgt_reference && c.ecgt_reference !== 'N/A')
        refs.push(`<span class="dd-ref">EU: ${esc(c.ecgt_reference)}</span>`);
      if (c.ftc_reference && c.ftc_reference !== 'N/A')
        refs.push(`<span class="dd-ref">US: ${esc(c.ftc_reference)}</span>`);

      let altsHtml = '';
      if (c.remediation?.compliant_alternatives?.length) {
        altsHtml = `
          <div class="dd-alts">
            <div class="dd-alts-t">Compliant alternatives</div>
            ${c.remediation.compliant_alternatives.map(a =>
              `<div class="dd-alt">${esc(a)}</div>`
            ).join('')}
          </div>`;
      }

      top.innerHTML = `
        <span class="dc-dot"></span>
        <div class="dc-bd">
          <div class="dc-title">${esc(c.description)}</div>
          <div class="dc-excerpt">${esc(trunc(c.matched_text, 70))}</div>
          <div class="dc-tags">${jurisTags}${sevTag}</div>
        </div>
        <span class="dc-chev">▶</span>`;

      const detail = document.createElement('div');
      detail.className = 'dc-detail';
      detail.innerHTML = `
        <div class="dd-row">
          <div class="dd-lbl">Found in text</div>
          <div class="dd-val">"${esc(trunc(c.sentence, 180))}"</div>
        </div>
        <div class="dd-row">
          <div class="dd-lbl">Legal reference</div>
          <div class="dd-val">${refs.join('') || '—'}</div>
        </div>
        <div class="dd-row">
          <div class="dd-lbl">Required action</div>
          <div class="dd-val">${esc(c.remediation?.guidance || '')}</div>
        </div>
        ${altsHtml}`;

      el.appendChild(top);
      el.appendChild(detail);
      box.appendChild(el);
    });
  } else {
    box.innerHTML = '<div style="padding:32px 20px;text-align:center;color:#9B9B9B;font-size:13px">No ECGT (EU) or FTC (US) violations detected on this page.<br><span style="font-size:11px;margin-top:4px;display:block">This does not guarantee compliance — only that no flagged terms were found in the visible page content.</span></div>';
  }

  // Certs
  const cbox = $('d-certs');
  if (d.certifications_found?.length) {
    cbox.style.display = 'block';
    cbox.innerHTML = '<div class="certs-title">Certifications</div>';
    d.certifications_found.forEach(c => {
      const v = c.verified;
      cbox.innerHTML += `
        <div class="cert-row">
          <span class="cert-dot ${v ? 'v' : 'u'}"></span>
          <div style="flex:1">
            <div class="cert-nm">${esc(c.certification_name)}</div>
            <div class="cert-st ${v ? 'v' : 'u'}">${v ? 'Verified: ' + esc(c.license_number) : 'Referenced — no license number found'}</div>
          </div>
        </div>`;
    });
  } else {
    cbox.style.display = 'none';
  }

  show('v-detail');
}

// ── Event Listeners ─────────────────────────────

$('btn-go').addEventListener('click', scan);
$('btn-retry').addEventListener('click', scan);

$('btn-detail').addEventListener('click', () => {
  if (lastResult) renderDetail(lastResult);
});

$('btn-back').addEventListener('click', () => {
  if (lastResult) renderConsumer(lastResult);
});
