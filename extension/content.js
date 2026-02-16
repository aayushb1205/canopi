/**
 * canopi Content Script
 * Extracts environmental claims from product pages and sends to API.
 * Runs on every page - only activates when popup requests a scan.
 */

// ── Configuration ───────────────────────────────────────────────

// ⚠️  IMPORTANT: Replace with your Railway deployment URL before publishing
// Example: "https://greencheck-production-abc123.up.railway.app"
const API_URL = "https://greencheck-production.up.railway.app";

// ── Platform Detection ──────────────────────────────────────────

function detectPlatform() {
  const url = window.location.href;
  const hostname = window.location.hostname;

  if (document.querySelector('meta[name="shopify-checkout-api-token"]') ||
      url.includes('/products/')) {
    return 'shopify';
  }
  if (document.body.classList.contains('single-product') ||
      document.querySelector('.woocommerce-product-details__short-description')) {
    return 'woocommerce';
  }
  if (hostname.includes('zalando')) return 'zalando';
  if (hostname.includes('asos')) return 'asos';
  if (hostname.includes('hm.com') || hostname.includes('h&m')) return 'hm';
  if (hostname.includes('zara.com')) return 'zara';
  return 'generic';
}

// ── Text Extraction ─────────────────────────────────────────────

function extractProductText() {
  const platform = detectPlatform();
  const sections = {};

  // ── Step 1: Open <details> elements only (safe, no navigation risk) ──
  // <details> elements are the only safe ones to expand programmatically
  // because they don't trigger navigation or JS handlers.
  // Everything else we read via textContent which reads hidden DOM text.
  try {
    document.querySelectorAll('details:not([open])').forEach(el => {
      el.setAttribute('open', '');
    });
  } catch(e) {}

  // ── Step 2: Extract text using textContent (reads hidden text) ─

  // Platform-specific selectors
  const selectors = {
    shopify: {
      title: '.product-single__title, .product__title, h1.product-title, [data-product-title]',
      description: '.product-single__description, .product__description, .product-description, .rte, [data-product-description]',
      sustainability: '[class*="sustain"], [class*="eco"], [class*="environment"], [data-sustainability]',
      materials: '[class*="material"], [class*="composition"], [class*="fabric"]',
    },
    woocommerce: {
      title: '.product_title, h1.entry-title',
      description: '.woocommerce-product-details__short-description, .product-description, .entry-content',
      sustainability: '[class*="sustain"], [class*="eco"]',
      materials: '.product_meta, [class*="material"]',
    },
    generic: {
      title: 'h1',
      description: '[class*="product-desc"], [class*="product-detail"], [class*="pdp-desc"], [itemprop="description"], .product-description',
      sustainability: '[class*="sustain"], [class*="eco"], [class*="green-claim"], [class*="environment"], [class*="conscious"], [class*="responsible"]',
      materials: '[class*="material"], [class*="composition"], [class*="fabric"], [class*="ingredient"]',
    }
  };

  const sel = selectors[platform] || selectors.generic;

  for (const [key, selector] of Object.entries(sel)) {
    const elements = document.querySelectorAll(selector);
    const texts = [];
    elements.forEach(el => {
      // Use textContent — reads ALL text including hidden accordion panels
      const text = el.textContent;
      if (text && text.trim().length > 3) {
        texts.push(text.trim());
      }
    });
    if (texts.length > 0) {
      sections[key] = texts.join(' ');
    }
  }

  // ── Step 3: Specifically hunt for hidden content panels ─────
  // These are the accordion panels, tab panels, and detail sections
  // that contain materials/sustainability info on modern product pages
  const hiddenContentSelectors = [
    // Accordion panels (often hidden)
    '[role="tabpanel"]',
    '.accordion-panel, .accordion-body, .accordion-content',
    '[class*="accordion"] [class*="panel"]',
    '[class*="accordion"] [class*="body"]',
    '[class*="accordion"] [class*="content"]',
    // Collapsible sections
    '.collapse, .collapsible-content',
    '[class*="collapsible"] [class*="content"]',
    // Details/summary
    'details',
    // Tab panels
    '.tab-pane, .tab-panel, .tab-content',
    // Common product detail sections (Patagonia, etc.)
    '[class*="product-detail"] [class*="panel"]',
    '[class*="pdp-detail"]',
    '[class*="product-info"]',
    // Specifically target materials/sustainability panels
    '[class*="material"] [class*="content"]',
    '[class*="sustain"] [class*="content"]',
    '[class*="feature"]',
    '[class*="spec"]',
  ];

  const hiddenTexts = [];
  hiddenContentSelectors.forEach(sel => {
    document.querySelectorAll(sel).forEach(el => {
      const text = el.textContent;
      if (text && text.trim().length > 10) {
        hiddenTexts.push(text.trim());
      }
    });
  });

  if (hiddenTexts.length > 0) {
    sections.hidden_panels = hiddenTexts.join(' ').substring(0, 15000);
  }

  // ── Step 4: Scan ALL text that mentions env keywords ────────
  // Walk the DOM and grab any element whose textContent contains
  // sustainability-related keywords, even if not caught by selectors
  const envKeywords = /recycl|organic|sustainab|eco-|environ|certif|carbon|climate|neutral|gots|oeko|bluesign|fair.?trade|b.?corp|GRS|RCS|offset|biodeg|compost|renewable/i;

  const allElements = document.querySelectorAll('p, span, div, li, td, dd, section, article');
  const envTexts = [];
  const seenTexts = new Set();

  allElements.forEach(el => {
    // Only check leaf-ish elements (avoid grabbing entire page containers)
    if (el.children.length > 10) return;
    const text = el.textContent?.trim();
    if (!text || text.length < 10 || text.length > 2000) return;
    if (seenTexts.has(text)) return;

    if (envKeywords.test(text)) {
      seenTexts.add(text);
      envTexts.push(text);
    }
  });

  if (envTexts.length > 0) {
    sections.env_mentions = envTexts.join(' ').substring(0, 10000);
  }

  // ── Step 5: Meta tags and image alt text ────────────────────
  const metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc) {
    sections.meta = metaDesc.content;
  }

  const imgs = document.querySelectorAll('img[alt]');
  const altTexts = [];
  imgs.forEach(img => {
    const alt = img.alt.toLowerCase();
    if (envKeywords.test(alt)) {
      altTexts.push(img.alt);
    }
  });
  if (altTexts.length > 0) {
    sections.image_labels = altTexts.join(' ');
  }

  // ── Step 6: JSON-LD structured data ─────────────────────────
  // Many sites embed product data in JSON-LD script tags
  document.querySelectorAll('script[type="application/ld+json"]').forEach(script => {
    try {
      const data = JSON.parse(script.textContent);
      const desc = data.description || data.productDescription || '';
      if (desc && desc.length > 10) {
        sections.structured_data = desc;
      }
      // Also check for material/composition in structured data
      if (data.material) {
        sections.structured_material = JSON.stringify(data.material);
      }
    } catch(e) {}
  });

  // ── Step 7: Fallback for sparse pages ───────────────────────
  const totalText = Object.values(sections).join(' ');
  if (totalText.length < 100) {
    const main = document.querySelector('main, [role="main"], #content, .content, article');
    if (main) {
      sections.fallback = main.textContent.substring(0, 10000);
    } else {
      sections.fallback = document.body.textContent.substring(0, 5000);
    }
  }

  return sections;
}

// ── Known Marketplaces ─────────────────────────────────────────

const MARKETPLACES = {
  'asos.com':      { name: 'ASOS',      brandSelectors: ['[data-testid="product-brand"]', '.product-brand', 'a[data-testid="brand-link"]', '[class*="brandName"]', '.product-hero h2 a'] },
  'zalando':       { name: 'Zalando',    brandSelectors: ['[class*="BrandName"]', '[data-testid="brand-name"]', 'h3[class*="brand"]', '.z-brand-logo', 'a[href*="/brand/"]'] },
  'farfetch.com':  { name: 'Farfetch',   brandSelectors: ['[data-component="ProductDesignerName"]', '[data-tstid="productDesignerName"]', 'a[href*="/designer/"]', 'h2[class*="designer"]'] },
  'nordstrom.com': { name: 'Nordstrom',  brandSelectors: ['[class*="brand-title"]', 'a[class*="brand"]', 'h2.product-title a', '[data-element="brand-link"]'] },
  'aboutyou':      { name: 'About You',  brandSelectors: ['[class*="brandName"]', 'a[href*="/brand/"]', '[data-testid="brand"]'] },
  'boozt.com':     { name: 'Boozt',      brandSelectors: ['[class*="brand"]', '.product-brand', 'a[href*="/brand/"]'] },
  'ssense.com':    { name: 'SSENSE',     brandSelectors: ['[class*="designer"]', 'a[href*="/designer/"]', '.product-designer'] },
  'mrporter.com':  { name: 'Mr Porter',  brandSelectors: ['[class*="designer"]', 'a[href*="/designer/"]', '.product-designer-name'] },
  'net-a-porter':  { name: 'Net-a-Porter', brandSelectors: ['[class*="designer"]', 'a[href*="/designer/"]'] },
  'depop.com':     { name: 'Depop',      brandSelectors: ['[class*="brand"]'] },
  'vestiaire':     { name: 'Vestiaire',  brandSelectors: ['[class*="brand"]', '[data-testid="brand"]'] },
  'amazon':        { name: 'Amazon',     brandSelectors: ['#bylineInfo', '#brand', 'a#bylineInfo', '.po-brand .po-break-word'] },
};

function isMarketplace() {
  const host = window.location.hostname.toLowerCase();
  for (const domain of Object.keys(MARKETPLACES)) {
    if (host.includes(domain)) return MARKETPLACES[domain];
  }
  return null;
}

function extractBrandName() {
  const marketplace = isMarketplace();

  // ── If on a marketplace, try to extract the product brand ──
  if (marketplace) {
    // Try marketplace-specific selectors
    for (const sel of marketplace.brandSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        const text = (el.textContent || '').trim();
        // Clean up common prefixes
        const cleaned = text
          .replace(/^by\s+/i, '')
          .replace(/^from\s+/i, '')
          .replace(/^brand:\s*/i, '')
          .replace(/^Visit the\s+/i, '')  // Amazon style
          .replace(/\s+Store$/i, '')       // Amazon style
          .trim();
        if (cleaned.length > 1 && cleaned.length < 100) {
          return cleaned;
        }
      }
    }

    // Try schema.org Brand markup (many marketplaces use this)
    const schemaBrand = document.querySelector(
      '[itemprop="brand"] [itemprop="name"], ' +
      '[itemtype*="schema.org/Brand"] [itemprop="name"], ' +
      'meta[itemprop="brand"]'
    );
    if (schemaBrand) {
      const val = schemaBrand.content || schemaBrand.textContent || '';
      if (val.trim().length > 1) return val.trim();
    }

    // Try JSON-LD structured data
    const jsonLd = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of jsonLd) {
      try {
        const data = JSON.parse(script.textContent);
        const brand = data.brand?.name || data.brand || data.manufacturer?.name;
        if (brand && typeof brand === 'string' && brand.length > 1) return brand;
      } catch(e) {}
    }

    // Last resort on marketplace: return marketplace name
    return marketplace.name;
  }

  // ── Not a marketplace: try standard brand extraction ──

  // JSON-LD first (most reliable)
  const jsonLd = document.querySelectorAll('script[type="application/ld+json"]');
  for (const script of jsonLd) {
    try {
      const data = JSON.parse(script.textContent);
      const brand = data.brand?.name || data.brand;
      if (brand && typeof brand === 'string' && brand.length > 1) return brand;
    } catch(e) {}
  }

  // Schema.org markup
  const schemaOrg = document.querySelector(
    '[itemtype*="schema.org/Brand"] [itemprop="name"], ' +
    '[itemprop="brand"] [itemprop="name"]'
  );
  if (schemaOrg) return schemaOrg.textContent.trim();

  // og:site_name (for brand-owned sites this is the brand)
  const ogSiteName = document.querySelector('meta[property="og:site_name"]');
  if (ogSiteName) return ogSiteName.content;

  // Fallback to domain name
  return window.location.hostname.replace('www.', '').split('.')[0];
}

// ── API Communication ───────────────────────────────────────────

async function scanPage() {
  const sections = extractProductText();
  const fullText = Object.values(sections).join('\n\n');
  const brandName = extractBrandName();

  if (fullText.trim().length < 20) {
    return {
      error: true,
      message: "Not enough text found on this page to scan.",
      score: "unknown"
    };
  }

  try {
    const response = await fetch(`${API_URL}/api/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: fullText.substring(0, 50000), // API limit
        url: window.location.href,
        brand_name: brandName,
      })
    });

    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }

    return await response.json();
  } catch (err) {
    return {
      error: true,
      message: `Could not connect to canopi API: ${err.message}`,
      score: "error"
    };
  }
}

// ── Message Listener ────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'scan') {
    scanPage().then(result => {
      sendResponse(result);
    }).catch(err => {
      sendResponse({
        error: true,
        message: err.message,
        score: "error"
      });
    });
    return true; // Keep message channel open for async response
  }

  if (message.action === 'extractText') {
    const sections = extractProductText();
    sendResponse(sections);
    return true;
  }
});
